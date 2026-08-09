---
name: miniapp-creator
description: "创建、修改和安装 Molibot Mini App（安装在 ~/.molibot/miniapps/ 下、同时提供 Agent 工具和桌面面板 UI 的可插拔应用）。当用户想做一个新的 Mini App、给 Agent 加一个带界面的能力（待办、记账、书单、习惯打卡等）、修改已有 Mini App 的工具或界面，或询问 manifest/工具/UI/数据目录契约时使用。"
---

# Mini App Creator

一个 Mini App = **Agent 工具 + 宿主托管的 UI + 一份私有数据**，三者共用同一个领域模块。用户在任意渠道说「帮我加个待办」由工具写入，桌面面板打开看到的是同一份数据。

**核心工作方式：永远从 `template/` 复制，不从零开始写。** 模板已经把 SQLite（WAL + 事务）、工具 handler、HTTP handler、轮询刷新、中英文、明暗主题、403/503 降级全部接好了，你只需要改领域逻辑。

完整契约见本 skill 目录下的 [reference.md](reference.md)。另外两份**一定在用户机器上**的活样例：已安装的 Todo 应用 `~/.molibot/miniapps/apps/todo/`（Molibot 首次启动时自动装入），以及本 skill 自带的 `template/`。如果手头有宿主仓库，还有更长的作者指南 `docs/guides/miniapps/authoring.md`。

## 工作流程

### 1. 先把领域问题问清楚

在写任何代码前确认三件事，缺一件就先问用户：

1. **数据长什么样**——一条记录有哪些字段？（这决定表结构，改起来最贵）
2. **Agent 要能做什么**——列出工具清单，每个工具是只读、普通写，还是不可逆删除。
3. **面板要看到什么**——列表？分组？统计？UI 只是同一份数据的第二个入口，不要设计出工具做不到的操作。

不要在用户只说了「做个记账的」就开始建表。字段错了要迁移数据，工具名错了只要改 manifest。

### 2. 生成骨架

脚本和模板都在**本 skill 自己的目录**里（提示词里的 `skill_file` 就是它的路径；标准安装位置是 `~/.molibot/skills/miniapp-creator/`）：

```bash
node ~/.molibot/skills/miniapp-creator/scripts/scaffold.mjs expenses "Expenses" ./expenses
```

用法是 `scaffold.mjs <app-id> "<显示名>" <目标目录>`。在当前 Session scratch 目录构建，不要把尚未验证的源码直接生成到正式安装目录。脚本会复制 `template/` 并分别转换 app id、名称、CSS 类前缀与 SQLite 安全表名，产物是**可以直接跑起来的完整应用**。目标目录必须不存在，且目录名必须等于 app id——脚本会当场拒绝，省得重启后才看到加载错误。

手工做也可以：复制本 skill 目录下的 `template/`，再把里面所有 `starter` / `Starter` 替换成你的 app id 与显示名。实在找不到模板时，退而复制 `~/.molibot/miniapps/apps/todo/`——那是随 Molibot 一起装好的参考实现，结构完全一样，只是内容是待办领域的。

**脚本跑完之后，用它打印出来的绝对路径继续。** 文件工具（`read`/`write`/`edit`/`ls`）能修改 scratch 构建；`miniapps/data/` 是各 App 自己的 SQLite 私有数据，不在可写范围内——那份数据只能通过 App 自己的工具和 HTTP 接口改。

### 3. 改领域层，而不是四处改

`server/index.mjs` 里只有一个 `Store` 类是领域层。按这个顺序改：

1. `SCHEMA` 常量——表结构、索引。
2. `Store` 的方法——校验、业务规则、事务，全部在这里。
3. `tools` 里的 handler——只做「调 Store + 组织给 Agent 看的文本」。
4. `handleHttp` 的 `route()`——只做「调 Store + 组织给 UI 看的 JSON」。

**最重要的一条规则**：工具 handler 和 HTTP handler 必须调同一批 Store 方法。任何一边自己写 SQL，Agent 和面板迟早会看到不一样的数据，而且只有同时用两个入口的用户会遇到。

### 4. 同步 manifest

`manifest.json` 的 `tools` 必须与 `tools` handler **完全一一对应**——少一个是 Agent 能调却必然失败的工具，多一个是没有 schema、没有风险分级的暗能力，两种情况都会让整个 App 加载失败并在设置里显示错误。

每个工具还要给对：

- `keywords`：工具是延迟加载的，Agent 靠 `toolSearch` 用领域关键词找到它们。**必须覆盖用户真正会说的词，中英文都要**（`["expense", "spend", "记账", "花了", "多少钱"]`），只写英文等于不可发现。
- `readOnlyHint: true` → 低风险；`destructiveHint: true` → 高风险，每次调用都要 owner 审批；都不写 → 中风险。两者不能同时为 true。**永久删除数据的工具必须标 `destructiveHint: true`。**
- `description`：写清楚「什么时候该调用我」，这是 Agent 唯一的判断依据。

### 5. 改 UI

`ui/app.js` 已经接好了轮询、错误降级和中英文表；改 `STRINGS`、`renderItem()` 和请求的 API 路径即可。

- 界面在独立 origin 的 sandboxed iframe 里，**拿不到宿主 DOM、Tauri IPC、Molibot 的设计 token**，这是设计如此，不可配置。
- **视觉走 Material Design 3（Google 风格），不要自己发明一套。** 模板 `ui/styles.css` 顶部那段 `--md-*` 基线（配色角色、字号/行高成对、形状、动效曲线、海拔）在模板和三个内置 App 里是**逐字复制**的同一份——每个 App 各自一个 origin，CSP 是 `default-src 'self'`，没有可共享的样式表，只能复制。所以：**只改基线就要四处同步**（`src/lib/server/miniapps/uiDesignBaseline.test.ts` 会在漂移时报错），而 App 自己的表达色（Note 的便签配色、Todo 的优先级色）以另一层变量叠在基线之上，不要动基线里的值。
  - 一切尺寸、字号、圆角、动效都用 token，不要写裸 `font-size: 13px`（同一个测试会拦）。字号必须和行高成对取用。
  - 交互态是 **state layer**：`background-color: color-mix(in srgb, currentColor 8%, transparent)`（hover）/ `12%`（focus、press），不是换一个背景色。已经有底色的实心按钮改用海拔 + `filter: brightness()`。
  - 层级用**色调 + 轻阴影**（`--md-surface-container-*` / `--md-elev-*`），不要描边分隔、不要毛玻璃、不要浓重投影。按钮一律胶囊形（`--md-shape-full`）。
  - 状态**不能只靠颜色**：chip 要带文字，完成项要有勾选控件 + 删除线。
- 只能用相对路径 `./api/*` 访问自己的 API。
- 内联 `<script>` 不会执行（CSP），代码必须放在 `.js` 文件里。
- 语言和主题从 `location.search` 的 `locale` / `theme` 读，启动时读一次就够（切换会重载 iframe）。
- App 要把内容送回聊天草稿时，只使用模板的 `molibotBridge.insertToComposer(text, mode)`。v1 只允许 `append | replace`，不会自动发送；宿主不支持或拒绝时 App 的核心功能仍必须可用。

### 5.1 跨边界声明与长任务

- 消息/选区/附件入口写进 `contributions.messageActions`；工具同时接受 Agent 参数和宿主 `{ capture }`，不要写两套领域逻辑。`accepts` 只声明真实支持的 `text | image | file`。
- 模型能力只通过 `context.ai.generateText()` / `transcribe()` 使用，先在 `ai.capabilities` 声明。凭据、Provider 和最终模型不属于 App；结构化错误码只有 `capability_not_declared`、`capability_unavailable`、`invalid_request`、`rate_limited`、`provider_failed`、`aborted`。
- raw 上传必须逐路由声明 `ai.uploadLimits`，路径为 `/api/*`，硬顶 25 MiB；JSON 路由保持 JSON。转写音频每段还必须 ≤10 分钟。
- 长任务把 job/segment 状态先落 SQLite；每个后台 Promise 都有 `catch`；Runtime 重建时把 `recording/transcribing/summarizing` 终态化为 `interrupted`。重试要幂等，原始输入保留到用户明确删除。

#### UI 铁律（每条都对应一个真实翻过车的 bug，违反一条就会出「点击没反应」类故障）

1. **styles.css 第一条规则永远是 `[hidden] { display: none !important; }`**（模板已带）。原因：`hidden` 属性只是浏览器默认样式表里的 `[hidden]{display:none}`，**任何作者样式里的 `display: flex/block/grid` 都会覆盖它**。真实案例：todo 的列表选择器写了 `.list-picker { display: flex }`，`hidden` 从此失效，它以 `opacity: 0` 的透明状态一直盖在搜索框和输入框上，把所有点击吃掉——用户看到的就是「输入框点了没反应」。**同一族的第二种写法同样要禁**：HTML 里的行内 `style="display:none"` 会盖过用来显示它的 class 规则（`.done-section.visible { display: block }`），元素照常渲染、永远不可见、控制台一声不吭——todo 的「已完成」分组就这样隐身了很久。显隐只由一处决定：class 或 `hidden` 属性，不要两者混用，更不要加行内 display。
2. **透明 ≠ 不可点。** `opacity: 0` 的元素照样参与命中测试。任何弹层/遮罩/菜单的关闭态必须落在 `display: none`（或 `visibility: hidden` / `pointer-events: none`）上，不能只靠 opacity + transform 做「视觉上消失」。
3. **带出场动画的关闭要管好 timer。** 「先移除 class、300ms 后再设 `hidden`」的模式必须把 `setTimeout` 的句柄存下来，重新打开时 `clearTimeout`，否则快速开→关→开会让残留的 timeout 把刚打开的面板重新藏掉。
4. **不要用 `prompt()` / `confirm()` / `alert()`。** iframe 没有 `allow-modals`，它们静默无效（不报错、不弹窗）。确认类交互一律用内联 DOM（把行内容替换成「确认/取消」按钮）。
5. **`body` 上不要写 `user-select: none`**——在 WKWebView（macOS 桌面端的 WebView）里会挡住输入框聚焦。需要禁选中就精确加在按钮等具体元素上。
6. **搜索框用 `type="text"`，不要 `type="search"`**——后者在沙箱 iframe 里有过聚焦/样式异常。
7. **全屏透明遮罩必须 `pointer-events: none`。** 「点遮罩关闭弹层」的 `.backdrop` 通常是 `position: fixed; inset: 0`，盖住整个视口。关闭态若只是 `opacity: 0` 而非 `display: none`，就是一层看不见的「点击黑洞」，把下面所有输入框的点击都吃掉——真实案例：todo 的遮罩在 300ms 淡出窗口里把搜索框和添加框的点击全吞了。写法：遮罩默认 `pointer-events: none`，只在激活态（如 `.show`）才 `pointer-events: auto`。
8. **关闭弹层时主动 `.blur()` 里面持焦的元素。** 弹层里的输入框（如「新建列表」）在弹层关闭后仍持焦点，键盘事件会继续落进去，直到 `hidden` 真正生效。WebKitGTK 会把这段关闭延迟拉长（见下「跨平台 WebView 差异」），用户就会遇到「点搜索框没反应、打字却进了弹层输入框」。写法：关闭分支里 `if (container.contains(document.activeElement)) document.activeElement.blur();`。
9. **`overflow: hidden` 会裁掉绝对定位的下拉菜单。** 卡片为圆角常写 `overflow: hidden`，但卡片内 item 右侧向下展开的菜单（`position: absolute; top: 100%`）会被它裁掉——列表短或点最后一条时整个菜单看不见，表现为「下拉框出不来」。写法：承载下拉的容器不要 `overflow: hidden`，圆角改用首/尾子元素的 `border-radius` 补；下拉靠近滚动容器底部时还要能向上翻转（量 `getBoundingClientRect()` 的剩余空间，不够就把 `top: 100%` 换成 `bottom: 100%`）。

#### 交互出问题时的排查顺序

先记住结论：**宿主样式进不了 iframe（独立 origin + sandbox + CSP），所以「样式串了/被外面影响」基本不存在；交互失灵几乎总是 App 自己的代码问题。**按下面顺序排查，不要一上来怀疑运行时环境：

1. **找出谁在吃点击**：在面板 WebView 的 devtools console 里跑 `document.elementFromPoint(x, y)`（x/y 用出问题控件的坐标）。返回的不是你以为的控件，就是有隐形浮层盖着——回头查铁律 1/2。
2. **看 console 有没有 CSP 拒绝**：内联 script 不执行、跨 origin 请求被拦都是静默失败，只有 console 里有记录。
3. **把 ui/ 拿到普通浏览器里复现**：写个几十行的静态服务器 + stub API，用一模一样的 `sandbox="allow-scripts allow-forms allow-same-origin"` iframe 套起来点一遍。**普通浏览器里也坏 = 代码 bug（绝大多数情况）；只有普通浏览器正常、仅 Tauri 里坏，才去怀疑 WebView 差异**（见下「跨平台 WebView 差异」；macOS=WKWebView / Linux=WebKitGTK / Windows=WebView2）。
4. 确认不是宿主遮挡（罕见）：面板头部 60px 之内是宿主的 window-drag-mask 区域，iframe 本体在其下方，正常不受影响；拖拽分栏时面板会临时 `pointer-events: none`，松手即恢复。

#### 跨平台 WebView 差异（macOS / Linux / Windows）

桌面端是 Tauri 应用，iframe 实际跑在哪个 WebView 里取决于操作系统：

| 系统 | WebView | 焦点 / 定时器表现 |
| --- | --- | --- |
| macOS | WKWebView | 基准，最接近标准浏览器 |
| Linux | WebKitGTK | 沙箱 iframe 里点击转移焦点更脆；非活动状态下 `setTimeout` 会被节流 |
| Windows | WebView2（Chromium 内核） | 接近 Chrome，一般无额外问题 |

**结论：在 Mac 上能跑 ≠ 在 Linux 上能跑。** WKWebView 上侥幸过的焦点 / 时序边界，到 WebKitGTK 上常常稳定复现。已知两类差异：

1. **沙箱 iframe 的焦点更脆。** WKWebView 里点输入框能聚焦，WebKitGTK 上点击转移焦点可能失效。`body { user-select: none }` 在 WKWebView 挡聚焦（铁律 5），而「弹层关闭后里面的输入框仍持焦点、键盘事件继续落进去」是在 Linux 上才暴露的（铁律 8）。防御写法：弹层关闭时主动 `.blur()` 里面持焦的元素，别指望点别处会自动转移焦点。
2. **定时器会被节流。** 「移除 class → `setTimeout` 300ms 后设 `hidden`」这种关闭动画，在 WebKitGTK 上 300ms 可能被拉长，原本一闪即过的「透明但仍可命中」窗口会持续数秒。防御写法：关闭态立即落到 `display: none` 或 `pointer-events: none`，不要只靠定时器善后（铁律 2 / 7）。

所以铁律不是「最佳实践」，而是「在某台机器上已经翻过车」的硬约束。只有 Mac 开发时更要照着写——你测不到的边界，Linux 用户替你踩。

### 6. 校验、安装并冷启动验证

源码完成后必须调用 `miniAppManage`：先用 `validate` 在临时数据库中加载 Runtime，校验 manifest、SQL 与工具 handler；通过后用 `install` 原子安装或更新，再用 `inspect` 从正式目录回读 app id、version 和 manifest hash。也可以由用户在侧边栏 **Mini Apps** 管理器安装本地文件夹 / ZIP / GitHub 仓库。

**证据规则：**没有成功的文件写结果，不得说已经改源码；没有成功的 `miniAppManage install`，不得说已经安装；没有 `inspect` 回读，不得声称正式目录版本；展示代码块不算执行。任何工具失败都要原样报告，不能用文字模拟成功。

**装完必须重启 Molibot 服务，V1 没有热更新。** 数据目录 `~/.molibot/miniapps/data/<app-id>/` 不受安装和升级影响。

如果当前会话没有真实重启和打开面板的能力，只能报告「安装完成，等待重启验证」，不得勾选下面的冷启动项目或说「可以正常加载」。

重启后按这条清单走一遍真实链路，不要只看代码通过：

- [ ] 设置里 App 状态是 active，不是 error（error 行会写明原因）。
- [ ] **冷启动首开面板不是空白**（历史上最常见的失败）。
- [ ] 在对话里让 Agent 写一条 → 面板 2 秒内自动刷新出来。
- [ ] 在面板里改一条 → 让 Agent 列一次 → 能看到改动。
- [ ] 在设置里关掉这个 App → 面板显示「已禁用」而不是转圈或报错。

### 7. 收尾检查

- [ ] 目录名 == `manifest.id`；`runtime.entry` 是 `.mjs`。
- [ ] 工具 handler 与 manifest 完全一致，不多不少。
- [ ] 两个入口共用同一个领域模块。
- [ ] 会改数据的调用返回 `changed: true`（这是面板刷新的唯一触发源）。
- [ ] HTTP 响应里没有宿主绝对路径、没有密钥，只有不透明 ID。
- [ ] 改了表结构就 bump `data.schemaVersion`，并**自己**先迁移数据——宿主不会替你迁移，它会直接停掉 App 报错。

## 边界

- 不要为 App 引入需要 `npm install` 的依赖：宿主不编译 TypeScript、不跑安装脚本，第三方依赖必须自带。SQLite 用 Node 内置的 `node:sqlite`。
- 不要试图让 UI 调 Agent 工具或走 MCP bridge——UI 直连自己的 API 是既定架构。
- App 服务端代码在独立子进程运行，崩溃、退出和卡死不会带走 Molibot 服务；但这只是**故障隔离，不是权限沙箱**。它仍以 owner 的系统权限运行，给用户装第三方 App 前必须说明：这等于用自己的权限运行别人的代码。
