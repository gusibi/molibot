# Agent 工作台（等距 3D 办公室）实施方案

> 状态：已定稿，待实施。本文档自包含，可在独立 session 中直接执行。
> 交付形态：macOS 桌面 App（apps/desktop）新增「Agent 工作台」窗口。

---

## 1. 背景与目标

用一个**拟人化、好玩**的页面直观展示所有 Agent 的实时状态：谁在干活、谁在闲着、绑定了哪些 Bot、当前哪个 Bot 派的活、有没有 Sub-agent 在跑。

视觉定稿为「**模拟人生视角的等距 3D 办公室**」（isometric diorama）：

- 整个场景是一层开放办公区，每个 Agent 一个工位，机器人角色是 3D 的。
- Bot 是前台接待区的接待员；新任务到来时，**信使机器人走路**把工单信封从前台送到对应 Agent 的桌上。
- 每个 Agent 头顶悬浮旋转水晶（致敬 The Sims 的 plumbob）指示状态：绿色旋转 = 干活中，灰色慢转 = 空闲，红色急转 = 出错。
- Sub-agent 在主工位旁弹出一张小桌子 + 小号机器人，干完消失。
- 办公室道具（绿植、饮水机、地毯、窗户）营造氛围。

**目标优先级：好玩 > 有用。** 但信息层必须真实可用：点工位能看到该 Agent 的 session、绑定 bots、运行历史。

### 非目标

- 不做 GLTF/Blender 模型、骨骼动画、阴影、后期处理 —— 全部用基础几何体 + 平光（Lambert），控制 3D 复杂度。
- 不做真实寻路算法（走道 L 形折线即可）。
- 不做 SSE 推送（v1 轮询即可，2~3 秒）。

### 已验证的前提（本方案基于当前代码核实）

- Agent 定义：`settings.agents`，契约类型 `DesktopAgentItem`（`src/lib/shared/desktop.ts:559`），含 `id/name/description/enabled/sandboxEnabled/modelRouting`。
- Bot→Agent 绑定：channel instance 配置中的 `agentId` 字段（见 `src/lib/server/app/desktopChannels.ts` 第 41、78 行附近）。
- 运行时注册表：`getRuntime()`（`src/lib/server/app/runtime.ts:96`）返回 `RuntimeState`，其中 `channelManagers: Map<string, Map<string, ChannelManager>>`（channel key → instanceId → manager）。
- 每个 channel runtime（`BaseChannelRuntime`，`src/lib/server/channels/shared/baseRuntime.ts:48`）持有一个 `RunnerPool`（`src/lib/server/agent/core/runnerPool.ts`），runner 按 `chatId::sessionId` 键控；`MomRunner.isRunning()` 已存在（`runner.ts:450`），`runStartedAt` 是 run 内局部变量（`runner.ts:545`），subagent 任务开始时间已有跟踪（`runner.ts:914` 的 `subagentTaskStartTimes`）。
- Sub-agent 事件：`RunnerUiEvent` 的 `subagent_execution` 类型，phase 有 `start/task_start/task_end/end`（参考 `src/lib/server/agent/subagentProgress.ts`）。
- 桌面端窗口：Tauri 配置了 `chat` 与 `settings` 两个窗口（`apps/desktop/src-tauri/tauri.conf.json`），前端通过 `?window=xxx` 分流（`App.svelte:180`），Rust 侧 `show_window(&app, "settings")` + `open_settings` command（`lib.rs:48`）。
- 桌面 API 模式：`src/lib/server/app/desktopXxx.ts`（纯函数 + 同名 `.test.ts`）→ `src/routes/api/desktop/xxx/+server.ts` → 契约类型加在 `src/lib/shared/desktop.ts` → 前端 `apps/desktop/src/lib/api.ts` 加 `loadDesktopXxx()`。
- 桌面 store 模式：`apps/desktop/src/lib/stores/*.svelte.ts`（runes store），UI 拆在 `apps/desktop/src/lib/settings/*Section.svelte`。**不要把领域逻辑放回 App.svelte。**
- 验证命令：根目录 `corepack pnpm run test:desktop-chat`（服务端 desktop 模块测试）、`corepack pnpm run desktop:check`（svelte-check）、`corepack pnpm run desktop:test`。

---

## 2. 拟人化词典（状态 → 视觉）

| 数据状态 | 判定来源 | 视觉表现 |
|---|---|---|
| 干活中 | 该 Agent 绑定的任一 channel instance 有 `isRunning()` 的 runner | 机器人打字（身体小幅弹跳 + 双手交替敲桌）、屏幕发光脉动、头顶绿水晶旋转 |
| 空闲 | `enabled` 且无活跃 run | 头顶灰水晶慢转、身体轻微左右摇摆、桌上咖啡杯、头顶飘「z」 |
| 停用 | `enabled: false` | 工位区域地面变暗、桌子盖防尘布（灰色块）、无机器人、无水晶 |
| 出错 | 最近一次 run 以 error 结束（v1 可从 run-history 判定） | 红水晶急转、可选头顶惊叹号 |
| Sub-agent 运行中 | `subagent_execution` start 后未 end | 主工位旁弹出小桌 + 0.6 倍小机器人（scale-in），结束后淡出 |
| 新任务派发 | 轮询 diff 出新增的 running run | 信使机器人从前台走 L 形路线到目标工位，放下信封，走回 |
| 任务完成 | diff 出 run 从 running 消失且成功 | 水晶变绿闪一下（可选：纸飞机飞出） |
| Bot 在线 | channel instance enabled | 前台对应接待员机器人存在，轻微上下浮动 |
| 沙箱模式 | `sandboxEnabled` | 可选彩蛋：工位加透明玻璃罩 |

**动画分两类，严格区分：**
- **循环动画**（打字、眨眼、水晶旋转、Zzz、浮动）：统一 `THREE.Clock` 驱动，永远在跑，幅度小。
- **事件动画**（信使送单、sub-agent 弹出、完成闪光）：由轮询 diff 出的事件触发，进入队列依次播放，不叠加不打断。

### 配色（与原型一致，flat 风格）

| 元素 | 颜色 |
|---|---|
| 干活机器人 | `#5DCAA5`（teal），眼睛 `#04342C` |
| Sub-agent | `#9FE1CB` |
| 空闲机器人 | `#B4B2A9`（gray），眼睛 `#2C2C2A` |
| 前台 Bot | `#AFA9EC` / `#CECBF6`（purple），眼睛 `#26215C` |
| 信使 | `#7F77DD`，信封 `#EEEDFE` |
| 忙碌水晶 | `#1D9E75`；空闲 `#B4B2A9`；出错 `#E24B4A` |
| 地板 `#D3D1C7`，墙 `#F1EFE8`，窗 `#B5D4F4`，桌 `#888780`，绿植 `#97C459` + 花盆 `#F0997B`，地毯 `#E1F5EE`，屏幕 `#9FE1CB`，咖啡杯 `#D85A30` |

---

## 3. 服务端：聚合端点 `GET /api/desktop/workbench`

### 3.1 契约类型（加到 `src/lib/shared/desktop.ts`）

```ts
export interface DesktopWorkbenchRun {
  chatId: string;
  sessionId: string;
  channel: string;        // telegram / feishu / qq / weixin
  instanceId: string;     // channel instance id
  botName: string;        // instance 显示名
  startedAt: number;      // epoch ms
  label: string;          // 最近一条活动摘要（工具名/子任务名），可为空串
  subagents: { agent: string; task: string; startedAt: number }[];
}

export interface DesktopWorkbenchAgent {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sandboxEnabled: boolean | null;
  bots: { channel: string; instanceId: string; name: string; enabled: boolean }[];
  runs: DesktopWorkbenchRun[];          // 正在运行的
  lastRunStatus: "success" | "error" | "none"; // 用于出错状态
}

export interface DesktopWorkbenchSummary {
  generatedAt: string;
  agents: DesktopWorkbenchAgent[];
  unboundRuns: DesktopWorkbenchRun[];   // agentId 为空的 instance 上的运行
  counts: { agents: number; busy: number; idle: number; disabled: number; botsOnline: number };
}

export interface DesktopWorkbenchResponse { ok: true; summary: DesktopWorkbenchSummary; }
```

### 3.2 运行时数据暴露（注意分层规则）

AGENTS.md 分层规则：**Channel 层只做消息收发，共享上层逻辑不下沉**。因此：

1. **`RunnerPool`（agent/core 层）加 `snapshotRunning()`**：遍历 `this.map`，返回 `{ chatId, sessionId, startedAt, label, subagents }[]`（只含 `isRunning()` 为 true 的）。
   - `MomRunner` 需要把 run 级别的元数据暴露出来：新增私有字段 `activeRunMeta: { startedAt: number; label: string; subagents: Map<string, {...}> } | null`，在 run 开始/结束处赋值与清空（`runStartedAt` 已在 `runner.ts:545` 局部存在，提升为字段即可）；`subagent_execution` 事件处理处（`runner.ts:914` 附近已有 `subagentTaskStartTimes`）同步维护 `subagents`。新增公开方法 `snapshotActiveRun()`。
   - 实现时**先读 runner.ts 现有结构再动手**，字段命名跟随现有风格；不要改动 run 主流程逻辑。
2. **`ChannelManager` 接口（channels/registry.ts）加可选方法** `snapshotRuns?(): { instanceId: string; runs: RunnerPoolSnapshot[] }`，在 `BaseChannelRuntime` 上实现为对 `this.runners.snapshotRunning()` 的**纯委托**（一行转发，不含逻辑），各 channel 子类自动继承。
3. **聚合逻辑放 app 层**：新建 `src/lib/server/app/desktopWorkbench.ts`：
   - 读 `settings.agents` 得到 Agent 列表；
   - 遍历 settings 中所有 channel instances 得到 bot 列表与 `agentId` 绑定（复用 `desktopChannels.ts` 的读取方式）；
   - 遍历 `getRuntime().channelManagers`，对实现了 `snapshotRuns` 的 manager 取运行快照，按 instance 的 `agentId` 归到对应 Agent；`agentId` 为空的归入 `unboundRuns`；
   - `lastRunStatus` 从 run-history 模块取该 agent 最近一条记录（复用 `desktopRunHistory.ts` 的读取函数；若按 agent 过滤不可行，v1 可先返回 `"none"`，出错状态推迟到 M3——在代码中留 TODO 并在 features.md 注明）。
4. 路由 `src/routes/api/desktop/workbench/+server.ts`：GET，鉴权/错误处理照抄兄弟路由（如 `agents/+server.ts`）。
5. 测试 `src/lib/server/app/desktopWorkbench.test.ts`：模仿 `desktopAgents.test.ts` 的写法（构造假 settings + 假 manager map），覆盖：绑定归组、未绑定归 `unboundRuns`、counts 正确、无 runtime 时返回空 runs 不抛错。**把新测试文件加进根 `package.json` 的 `test:desktop-chat` 脚本列表。**

### 3.3 轮询频率与开销

端点只读内存中的 Map 和 settings，无 IO 重活，2.5s 轮询无压力。不做缓存。

---

## 4. 桌面端

### 4.1 新窗口（Tauri）

1. `apps/desktop/src-tauri/tauri.conf.json` 的 `windows` 数组加：
   ```json
   {
     "label": "workbench",
     "title": "Agent Workbench",
     "url": "index.html?window=workbench",
     "width": 1000, "height": 720, "minWidth": 760, "minHeight": 560,
     "center": true, "visible": false,
     "titleBarStyle": "Overlay", "hiddenTitle": true
   }
   ```
2. `lib.rs`：加 `open_workbench` command（照抄 `open_settings`，`show_window(&app, "workbench")`），注册进 invoke handler；托盘/菜单里加入口（找到现有 settings 菜单项的注册处，同样方式加一条）。
3. 检查 `apps/desktop/src-tauri/capabilities/default.json`：把 `workbench` 窗口 label 加进 capability 的 `windows` 列表（settings 怎么配就怎么配）。
4. `tauri.bundle.conf.json` 若单独维护 windows 配置也要同步（先确认）。

### 4.2 前端结构

```
apps/desktop/src/
├── App.svelte                     # 加 window=workbench 分支，渲染 WorkbenchPage
└── lib/
    ├── api.ts                     # + loadDesktopWorkbench(endpoint)
    ├── i18n.ts                    # + workbench 相关文案（中英双语，跟随现有 key 风格）
    ├── stores/
    │   └── workbench.svelte.ts    # runes store：轮询、diff 出事件、暴露纯数据
    └── workbench/
        ├── WorkbenchPage.svelte   # 页面壳：顶部统计条、canvas 容器、详情抽屉
        ├── WorkbenchDrawer.svelte # 点工位后的侧边抽屉（纯 Svelte + Geist）
        └── scene/
            ├── WorkbenchScene.ts  # 纯 TS 类：init(canvas) / syncState(data) / playEvents(events) / dispose()
            ├── builders.ts        # robot / desk / workstation / props 程序化建模
            ├── layout.ts          # 工位网格排布 + 走道路径计算
            └── animations.ts      # 循环动画 tick + 事件动画队列
```

**硬性规则：**
- Three.js 对象**绝不**放进 `$state`（Svelte Proxy 包装 Object3D 会摧毁性能）。store 只存纯 JSON 数据；组件 `onMount` 创建 `WorkbenchScene`，用 `$effect` 把 store 数据传给 `scene.syncState()`。
- 模板里不要用无参函数调用取派生数据（Svelte 5 legacy 模式下不追踪依赖），用 `$derived`/`$:` 显式引用依赖。
- 样式走语义类名（DESIGN.md §CSS 命名约定），视觉体系用 Geist（DESIGN.vercel.md，桌面端已废弃 Liquid Glass）。开关控件如有则必须用 `IosSwitch`。
- 不写任何绝对路径。

### 4.3 依赖

```
pnpm --dir apps/desktop add three
pnpm --dir apps/desktop add -D @types/three
```

用 ESM import；标签层用 three 自带 `three/examples/jsm/renderers/CSS2DRenderer.js`。

### 4.4 场景规格

**相机**：`OrthographicCamera`，位置约 `(12, 9.5, 12)` lookAt 场景中心，经典等距角。视锥 `d` 按地板尺寸自适应（见布局）。

**光照**：`AmbientLight(0xffffff, 0.85)` + `DirectionalLight(0xffffff, 0.6)`，无阴影。

**材质**：全部 `MeshLambertMaterial`（水晶用 emissive 提亮，屏幕用 `MeshBasicMaterial` + opacity 脉动）。

**工位自动排布（layout.ts）**：
- 每行 3 个工位，工位间距 x 方向 3.4、行间距 z 方向 3.2（行间即走道）。
- 地板尺寸 = 工位包围盒 + 前台区（固定在场景 +z 前侧）+ 边距 1.2；墙沿 -x 与 -z 两侧。
- Agent 增删 → 重新排布：新工位从地下升起（y 从 -1 到 0 ease），删除的沉下去后移除。
- 相机视锥 `d` 随地板对角线缩放，保证整个 diorama 始终完整入画。

**信使路径**：起点前台 → 沿前侧走道横移到目标列 → 沿列间走道直行到目标行 → 停在工位前。折线 waypoints 由 layout.ts 给出，匀速插值，朝向 = 段方向 `atan2`。步行动画：身体 `|sin|` 弹跳 + 双脚交替抬起 + 轻微侧倾。

**标签（CSS2DRenderer）**：每个工位一个 HTML 名牌（Agent 名 + 状态文案 + 当前工单摘要），前台一个「前台 · Bots」名牌。名牌是真实 DOM，用语义类（如 `.workbench-nameplate`、`.workbench-nameplate--busy`），自动继承主题与暗色模式。CSS2D 层容器与 WebGL canvas 叠放，`pointer-events: none`（名牌本身可开 auto 以支持点击）。

**交互**：
- 按住拖动：旋转整个 room group，clamp ±0.7 rad，松手 2.5s 后回到缓慢自动摇摆。
- `Raycaster` 点击工位（给每个工位 group 挂 `userData.agentId`）→ 打开 `WorkbenchDrawer`：显示该 Agent 的描述、模型路由、绑定 bots、正在运行的 sessions（含 chatId/开始时间/最近活动 label）、跳转设置按钮（打开 settings 窗口对应 section，可用现有 pendingSection 机制，见 `App.svelte:370`）。
- hover 工位：该工位轻微升起 0.06（可选）。

**事件队列（animations.ts）**：
- store 每次轮询后 diff：`newRuns`（信使送单）、`endedRuns`（完成闪光）、`newSubagents`（弹小桌）、`endedSubagents`（小桌淡出）、`agentAdded/Removed`（工位升降）。
- 队列串行播放，每个事件动画有最长时长（信使 ≤ 6s）；队列堆积超过 3 个时只保留最新的同类事件（防抖）。
- 信使动画进行中若目标 run 已结束，照常送完（视觉一致性优先）。

**性能**：
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`。
- `document.hidden` 或窗口 blur 时暂停 `setAnimationLoop` 与轮询；恢复时立即拉一次数据。
- 组件销毁：停 loop、`renderer.dispose()`、遍历 scene 释放 geometry/material、移除 CSS2D DOM。WKWebView 的 WebGL context 不会自动回收，必须手动释放。

### 4.5 页面壳（WorkbenchPage.svelte）

- 顶部统计条（Geist 卡片）：Agents 总数 / 忙碌 / 空闲 / 停用 / Bot 在线数，数据来自 `summary.counts`。
- 主体：3D canvas（占满剩余空间，随窗口 resize 更新相机与 renderer 尺寸）。
- 右侧抽屉：`WorkbenchDrawer.svelte`，滑入滑出用 Svelte transition。
- 空状态：一个 Agent 都没有时，显示空办公室 + 引导文案「去设置里创建第一个 Agent」（按钮打开 settings 窗口 agents section）。
- 服务未就绪（endpoint 为空）：复用现有 status 处理方式（参考 App.svelte 中 `serviceReady` 的用法）。

---

## 5. 里程碑

每个里程碑独立可合并、可验证。**每个切片完成时必须同步更新 `features.md` 和 `CHANGELOG.md`**（长期规则，不可跳过）；开工前把本功能登记进 `prd.md`（引用本文档路径）。

### M1 — 数据链路 + 静态办公室

服务端：契约类型、`RunnerPool.snapshotRunning()`、`MomRunner.snapshotActiveRun()`、`ChannelManager.snapshotRuns?` 委托、`desktopWorkbench.ts` + 路由 + 测试（进 `test:desktop-chat`）。
桌面端：Tauri 窗口 + `open_workbench` + 托盘入口、`api.ts`、`workbench.svelte.ts`（轮询 + 暂停恢复）、`WorkbenchPage.svelte` 壳 + 统计条、three 依赖、`WorkbenchScene` 渲染静态场景：地板/墙/窗/道具 + 按真实 Agent 数量排布工位 + 前台按真实 bot 实例摆接待员 + CSS2D 名牌 + 拖动旋转。

验收：打开工作台窗口能看到与设置中 Agent/Bot 数量一致的办公室；增删 Agent 后（轮询周期内）工位数变化；`test:desktop-chat` 与 `desktop:check` 通过。

### M2 — 状态动画

忙碌（打字 + 屏幕 + 绿水晶）、空闲（摇摆 + Zzz + 咖啡 + 灰水晶）、停用（暗区 + 防尘布）、Bot 在线浮动；名牌状态文案与工单摘要；统计条实时。

验收：给某个绑定了 bot 的 Agent 发消息触发真实 run，对应工位在一个轮询周期内切到忙碌态，run 结束后回到空闲态。

### M3 — 事件动画 + 交互

事件 diff 队列：信使送单、sub-agent 小桌弹出/消失、完成闪光、工位升降；Raycaster 点击 → 抽屉；出错状态（红水晶，接 run-history 或 M1 留的 TODO）。

验收：新任务到来能看到信使完整走一趟；触发一个会派生 sub-agent 的任务能看到小桌弹出；点工位抽屉数据正确。

### M4 — 彩蛋与打磨（可选）

SOUL.md/IDENTITY.md 驱动每个机器人的配色与桌面小物件；沙箱玻璃罩；hover 升起；空状态插画；性能复测（10+ Agent 场景帧率）。

---

## 6. 风险与决策记录

- **为什么不用 CSS/DOM 动画**：已做过 CSS 原型，用户明确要 3D；已用 three.js 做过两版原型（剖面楼、等距办公室）验证基础几何体 + Lambert 即可达到目标观感，等距办公室版为最终定稿。
- **为什么轮询不用 SSE**：观赏型页面，2.5s 延迟可接受；SSE 留给后续需要精确事件时序时再上。
- **为什么 `snapshotRuns` 放接口可选方法**：避免动所有 channel 子类；`BaseChannelRuntime` 一处实现全部继承，且保持 channel 层零业务逻辑（分层红线）。
- **文字为何不用 canvas 贴图 sprite**：Retina 模糊、不吃主题/暗色模式；CSS2DRenderer 用真实 DOM 解决。
- **runner 改动风险**：`MomRunner` 是核心执行器，只加元数据字段与只读快照方法，不碰控制流；实施时若发现已有等价数据结构（如 turn 对象上的 startedAt），优先复用而不是新增。
