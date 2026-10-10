Archived: 2026-10-10

### 输入框统计面板改为 Session 累计口径（2026-09-12，已交付）

- 背景：owner 反馈「最后一条回复显示 51.1k tokens，容量环却只有 2.49万」——两者都对但口径不同：回复下方是本轮全部模型调用的用量之和（含缓存读取，两次调用把共享上下文各计一次），容量环是最近一次请求的输入上下文。经比对用量页账本确认数字自洽（24,730 + 26,380 = 51,110；186 + 24,704 = 24,890）。按已确认的 [Session 用量需求](../requirements/session-usage-summary.md) 把输入框统计面板改成 Session 累计为主。
- 服务端：`AiUsageTracker.getSessionUsage(sessionId)` 按账本 sessionId 聚合（总/输入/输出/缓存读取/缓存写入 + `coverageStart` 覆盖边界）；`/api/sessions/[id]` 与 Project 会话详情路由随 transcript 返回 `usage` 汇总，账本读取失败返回 `available:false`，与真实零用量可区分。
- 桌面端：`ComposerContextMenu` 重排——「本会话累计用量」（总 tokens + 输入/输出/缓存读取/缓存写入 + 累计缓存命中率）为主区，「当前上下文」单列其下；进度环表达当前已使用上下文占用。usage 挂在会话 registry entry 上（entry 与 sessionId 绑定，后台会话刷新不会串到当前面板）；主 Chat 与 Project Chat 复用同一组件与口径，中英文案齐备。
- 口径修正：删除原「每轮命中率的算术平均」（平均缓存命中率 76% 这类数字），命中率改为累计缓存读取 / 累计完整输入（spec 验收口径 8,114/84,028 = 9.66%）；缓存读取/写入作为输入明细，不再与完整输入相加。
- 二次修正（同日，owner 提出一轮对话后累计与上下文"对不上"）：上下文一栏从「最近一次请求的输入」改为「**当前上下文**（已使用上下文）」= 最后一次请求输入（含缓存）+ 该次回复输出，即下一次发送的起点（真实案例 17,246 + 2,393 = 19,639，不再是孤立的 1.72万）。中间工具调用的输出已包含在最后一次输入内，回合聚合输出只带来每次几十 token 的正偏差；无快照旧会话退化为回合聚合用量对照模型配置窗口。配套解释了该轮累计 8.63万 的构成：一轮 6 次调用 = 首次尝试 3 次（最后一次空响应触发 `empty_response_retry` 整轮重跑）+ 重跑 3 次，gemini-3.8-flash-high 路由不回报缓存（命中率 0% 属实回报）。
- 验证：tracker 汇总测试 2 例（spec 验收数字 88,084/9.66% + 未知会话零值）+ presentation 测试 16 例（含 19,639 当前上下文场景）全过；desktop 测试链 297 + 守卫 255 全过（`presentation.test.ts` 顺带注册进测试链，此前不在链内）；svelte-check 0 错误；tsc 无新增错误；desktop 与服务端 build 通过。隔离实例冷启动冒烟：临时 DATA_DIR 起服务 → 建会话 → 注入账本记录 → API 返回累计 88,084 且排除他会话记录 → 重启后累计不变 → 全新会话显式零值。**桌面 UI 真机走查未做**：需在 app 里开面板确认布局（中英/明暗/窄宽）。

### 模型请求携带会话亲和头 x-molibot-session（2026-09-12，已交付）

- 背景：用户会话经 cli-proxy-api 调 opencode Go 路由的模型（如 deepseek-v4.1-flash-oc）每轮全部 400 `MissingSessionID`——opencode Go 要求第三方客户端带 `x-opencode-session`（每会话稳定 ID）用于会话粘性路由与提示缓存优化；同时用户在用量页看到的 0 token 记录即这些失败调用（失败无 usage 可报，但会话路径落库时未标记 error 状态，视觉上像"成功但 0 用量"）。
- 方案（owner 确认）：molibot 发自有通用头 `x-molibot-session: <sessionId>`，上游方言在代理层映射（cli-proxy-api 配 `x-opencode-session: "$x-molibot-session"`），molibot 不耦合任何单一上游的头名。
- 实现：注入点收在共享漏斗 `streamWithPiRuntime`——`options.sessionId` 存在时合并 `x-molibot-session` 头（`withSessionAffinityHeaders`，pi-ai 原生 `options.headers` 最后合并）；runner 主循环（含全部 fallback 候选尝试）与标题总结链路（conversationId 作为 sessionId）传入会话身份。无会话的调用（设置页连通性测试、owner 级助手）不带头，行为不变。
- 边界：图像识别引擎与 durable preflight 的 dispatch 暂未传 sessionId（当前无上游需要），后续有需要时同样只需在调用方传 `options.sessionId`；subagent 经 pi-agent-core 自有 Agent 实例分发，不在本漏斗内。
- 验证：新增 `piRuntime.sessionHeaders.test.ts` 3 例（带头/保留已有头/无会话不动）+ titleSummarizer sessionId 透传 1 例全过；runner.test 36/36、runnerHelpers 7/7、piTelemetry 3/3 回归全过；tsc 无新增错误。**端到端未验证**：需用户在 cli-proxy-api 配好映射并重启后跑一轮对话，确认 `model-errors.jsonl` 不再出现 MissingSessionID。

### 执行与权限保存失败修复 + 桌面 API 传输守卫（2026-09-12，已交付）


- 用户反馈「执行与权限」设置保存永远显示「保存失败，请重试。」。根因：`ExecutionPermissionsSection.svelte` 是全仓库唯一绕过共享 api transport、直接用原生 `fetch` 调 sidecar 的组件——桌面 webview 源是 Tauri 自定义协议、sidecar API 在 `http://127.0.0.1:<port>`，原生 fetch 属跨源请求且 sidecar 不带 CORS 头：PATCH 的预检（OPTIONS 405）必挂，GET 响应同样不可读但被 `.catch(() => undefined)` 静默吞掉（页面显示的「已保存模式」从未真正加载过，一直显示代码初始值）。curl、服务端直测、同源浏览器全部通过，唯独 app 内必挂，因此 issue #49 的服务端验证没拦住。
- 修复：`api.ts` 新增 `saveDesktopExecutionDefault`（走 `requestJson`/`fetchFromDesktop`，Tauri 内自动切 HTTP plugin 由 Rust 侧发请求），组件加载/保存两处全部换成共享 helper；加载失败从静默吞掉改为可见错误横幅（与 sandbox 加载一致）。服务端 `/api/desktop/execution-default` 无需改动（curl 直测 GET/PATCH 全链路正常）。
- 机器守卫：新增 `apps/desktop/src/api-transport-guard.test.mjs`（注册进 desktop test 链），禁止 `lib/api.ts` 之外任何源码直接调用 fetch（负向验证过能拦住修复前的写法）；`api.test.ts` 新增 execution-default PATCH 传输契约用例（方法/路由/body）；CLAUDE.md Recurring Pitfalls 补条目（首犯即配守卫：此类故障在浏览器/服务端测试里完全不可见）。
- 验证：`svelte-check` 0 错误 0 警告、desktop mjs 测试 255/255（含新守卫）、`api.test.ts` 109/109、desktop vite build 通过、运行中服务直测 GET/PATCH 正常。**真实桌面 webview 冷路径走查未完成**：computer-use 缺辅助功能/屏幕录制授权无法驱动真实窗口；修复代码已在运行的 dev 实例（vite 1420）上，手测路径：设置 → 执行与权限 → 切换模式 → 保存修改，应显示保存成功且重进页面保持所选模式。

### Chat 玻璃材质透明度整体加强（2026-09-12，已交付）

- 用户反馈输入区上方弹层（已排队栏 + 悬浮输入卡）透明感不足、接近不透明卡片。根修在共享玻璃 token 层：整条密度带下移 8 个点——`--glass-surface-bg` 74%→66%、`--glass-popover-bg` 80%→72%、`--glass-chrome-opacity` 80%→72%，所有玻璃表面（卡片、菜单、药丸、工具栏、输入卡及其上方条带）统一变透，材质体系保持单一；磨砂模糊（28–40px）与饱和度提升不变——DESIGN.md 约定可读性来自磨砂而非密度，降密度不损文字可读性。全部数值仍在守卫区间（65–92%）内，降透明度/低性能/高对比度的不透明降级不变。
- 同步更新 DESIGN.md「Chat glass materials」记录的密度值。
- 验证：`chat-ui.test.mjs` 全绿（含玻璃密度带守卫、popover>surface 层级守卫、模糊/饱和度下限守卫）、desktop vite build 通过；冷启动实测透明观感未做，建议在明暗主题下各看一眼弹层与菜单。

### 上下文面板圆环触发器 + 缓存无数据显示 + 排版放宽（2026-09-12，已交付）

- 触发器从折线图标改为**进度圆环**：一圈 = 上下文窗口的 100%，蓝色弧线即当前占用百分比，不开面板就能直观看到还剩多少容量；无数据时为空环。
- 缓存命中率 0% 的排查结论：取值与统计均正确——用户会话的每条调用上游（cli-proxy-api）确实报了 cacheRead=0（同一模型走 Telegram 的调用有命中，证明链路映射无损；web 图片类负载上游隐式缓存未命中）。显示规则（按用户要求）：只要会话有用量的调用，缓存命中率**常驻显示**，0% 也如实展示；仅完全无用量（全新会话）时空态隐藏。
- 弹层排版放宽：面板 300→320px，内边距 12/14→14/16，区块间距 10→12px，分类行距 7→9px，缓存行上边距 10→12px。
- 验证：presentation 单测 14/14（新增全零缓存→null 用例）、svelte-check 0 错误、desktop build 通过；harness 实测圆环弧线（26%）、空环、放宽后面板排版（明暗主题）。

### 用量账本增加会话维度（2026-09-12，已交付）

- 落地"用量控制统一走用量账本"的第一、二步（不新造第三种统计维度）：`AiUsageRecord` 增加可选 `sessionId`（会话 id），runner 的账本记录点带上当前会话；Mini App、assistant 等非会话调用不携带该字段。聚合层 `buildDesktopUsageSummary` 的 rankings 新增 `sessions` 维度（只统计携带会话 id 的记录），用量页排行榜新增"会话"tab，按所选时间范围与筛选条件展示每个会话的请求数/token 明细，按总量排序。
- 定位澄清：这个维度记的是真实消耗账，供后续 session 级限额/预算闸门读取；与转写消息上的 usage、上下文面板的分类构成快照各司其职，不互相替代。历史记录（本功能上线前）无 sessionId，不出现在会话排行中。
- 验证：账本 JSONL round-trip 用例（带 sessionId 存取、不带时字段缺席）+ 聚合会话分组用例（7 天窗口合计、today 窗口、非会话记录排除）全过；runner/api/steer 146 测试、svelte-check 0 错误、desktop build 通过。排行榜会话行目前显示会话 id，标题联动（跨渠道按 id 解析会话标题）留作后续打磨。

### Chat 输入框上下文用量面板（2026-09-12，已交付）

- Chat 与 Project 会话的输入框底栏（模型选择器左侧）新增上下文用量仪表：图标触发器常驻，弹出只读玻璃面板，展示上下文容量（已用/窗口 + 百分比 + 进度条）、六类占比明细（消息 / MCP 工具 / 系统工具 / 系统提示词 / 技能 / 其他）与平均缓存命中率；中英文案、明暗主题、reduced-transparency 降级齐备。数据分两档降级：有分类快照（本功能上线后产生的新回复）显示全部内容；历史会话无快照时用消息上的真实 usage + 所选模型配置的上下文窗口渲染容量条与命中率、隐藏分类行；完全无 usage（全新会话）显示"收到回复后展示"空态提示。注意数据源不是「用量」页的全局聚合（无会话维度、无分类信息），而是每条 assistant 消息自带的真实 token 报告 + dispatch 时服务端的分类估算。
- 数据链路（共享层一条线）：runner 在每次 dispatch 的 `streamFn` 里复用 preflight 估算器算出分类明细（`estimateContextBreakdown`，技能按 `<available-skills>` 区块从系统提示词中拆出、工具按 `mcp__` 前缀分 MCP/内置）；assistant 消息落盘时（`message_end` → `appendContextMessage`）把估算与该次调用真实报回的 input/cacheRead/cacheWrite 合成 `SessionContextSnapshot` 挂到 session entry 上（不进模型上下文）；投影层把快照带到 assistant 消息，`/api/sessions/[id]` 透传，前端 `deriveComposerContextUsage`（presentation.ts）取最后一条快照、用该次调用自身的 input 侧当已用量（回合聚合 usage 会重复计入共享上下文，不可用），缓存命中率取每次调用命中率的均值。
- 验证：估算器/投影/落盘 round-trip 新增 4 个回归用例 + `presentation.test.ts` 4 个新用例全过；服务端 core+session 185、store+api 125、桌面 291、UI 守卫 245 全绿；`svelte-check` 0 错误（含修复了此前工作区遗留的 ChatView 3434 prop 未声明错误）；desktop vite build 通过。隔离 harness 实测明/暗主题与降透明度渲染（面板结构、锚定、数据与参考设计一致）；真实桌面冷启动 + 真实模型调用的端到端走查未做（新快照在下次真实对话的首个回复后出现）。

### 项目设置弹窗按钮回归全局扁平样式 + 共享 Button 组件 + 弹窗 scrim 磨砂（2026-09-12，已交付）

- 用户反馈项目设置弹窗按钮（保存/取消/添加命令）是"四不像的业态玻璃"：根因是 `.project-settings-modal` 专属覆盖把全局按钮改造成 38px 药丸 + 内嵌高光 + 柔和投影，与全局 32px 扁平按钮（纯色主按钮/描边次按钮）完全脱节。根修：删除该覆盖及配套的 38px 搜索框高度，弹窗内按钮/控件直接吃全局样式。
- 新增共享 `components/ui/Button.svelte`（variant: primary/secondary、danger、class 透传、submit 支持），渲染全局 `.primary-button`/`.secondary-button` 类；ProjectSettingsDialog 的取消/保存/添加命令改用组件。样式源仍是全局 CSS 单一来源，组件只是规范入口；其余面板逐步迁移即可，任何面板再想分叉按钮样式都被守卫拦住。
- blur 效果落在共享 Dialog 层而非按钮上：新增 `--glass-modal-filter`（popover 档 blur(28px) saturate(190%)），`.desktop-dialog-overlay` 组合 `--modal-scrim` + 磨砂，所有弹窗统一获得"背景结霜、面板不透明"的层次；reduced-transparency 下降级为 none。DESIGN.md「Chat glass materials」已补条目。
- 验证：桌面结构测试 254/254（含新增守卫"弹窗不得分叉全局按钮样式"）、`svelte-check` 0 警告（仅存 1 个与本次无关的既有错误：ChatView.svelte:3434 `composerContextUsage` prop，来自工作区未提交的 ChatInputArea 改动）、desktop vite build 通过。运行中桌面的冷启动冒烟走查未完成，建议实际打开项目设置核对按钮观感与弹窗背景磨砂。

### 项目设置「自动任务」标签字号回归标准字阶（2026-09-12，已交付）

- 用户反馈项目设置弹窗的「自动任务」标签字号偏大。分析确认不是硬编码像素，而是 9 月 6 日 fixed-size project settings dialog 提交引入的一层 `.project-settings-modal` 专属覆盖：卡片标题 19px（`--fs-section`）、预览/摘要/页脚 14.5px（`--fs-body-lg`）、外加 0.3–0.6px letter-spacing——这 19/14.5 两档是 styles.css 自造刻度，DESIGN.md 字阶里不存在；而同弹窗「常规」标签用 `--fs-label`(13px)，与全局任务页也不一致。
- 根修：删除该字号覆盖层（含详情标题与按钮字号的特例），弹窗内自动任务回落到共享 automation 样式的标准 token（标题 `--fs-title` 15px、正文/摘要 `--fs-meta` 11px、按钮 `--fs-label` 13px），与全局任务页及「常规」标签同一字阶；保留弹窗的阴影、圆角、38px 控件等视觉处理，不受影响。
- 验证：`chat-ui.test.mjs` 243/243（含字阶守卫与 11px 下限守卫）。运行中桌面的冷启动冒烟走查未完成，建议实际打开项目设置 → 自动任务核对。

### 思考档位选择器对齐与可读性修复（2026-09-12，已交付）

- 恢复档位按钮的定位样式类，刻度均匀分布，选中圆点和焦点显示在滑块上方。标题与当前档位左右对齐，轨道下方显示首尾档位；支持点击及左右方向键切换。
- 根因是样式绑定遗漏。原有菜单角色测试没有覆盖按钮定位类，现已补上回归检查；未新增长期规则。
- 验证：桌面 UI 测试 243/243，svelte-check 0 错误 0 警告，desktop build 通过；隔离控件实测中文、英文、点击与方向键。完整桌面冷启动、Session 切换、服务中断恢复、暗色主题和真实移动视口走查未完成，浏览器主界面停在本地服务发现阶段。

### Chat 输入区下拉菜单与发送按钮密度收紧（2026-09-12，已交付）

- 用户反馈权限模式菜单与模型菜单行高过于稀疏、发送按钮偏大。`styles.css` 收紧：权限菜单选项改为两行布局（名称一行、提示一行，图标与勾选对齐首行，提示用 meta 字号次级色），菜单通用行 42→34px、模型列表行 36→28px，provider 分组头/分隔/页头间距同步收紧，来源脚注 padding 收窄。
- 发送按钮 32→28px，图标 `--icon-md`→`--icon-sm`，与输入区其它 28px 控件对齐。
- 模型下拉改为参考图式弹窗：思考档位从二级列表改为弹窗首页的横向轨道选择器（当前档位名居中 + 轨道圆点 + 滑块，点击/方向键直接切档，不关菜单）；「思考档位」二级页删除，仅保留模型选择二级页。
- 模型下拉列表乱序（跟随 provider 配置出现顺序）：共享层 `groupModelOptions`（presentation.ts）改为两级字母排序——分组按 provider 显示名、组内模型按显示名（`localeCompare` + `numeric`，Kimi K2.7 Code 正确排在 Kimi K3 前）；同时作用于 Composer 模型菜单、设置模型页和 Mini Apps AI 设置三处消费方。
- 验证：`presentation.test.ts` + `modelSelection.test.ts` 10/10（新增两级排序守卫用例）、`chat-ui.test.mjs` 242/242、`svelte-check` 0 错误 0 警告、desktop vite build 通过；横向轨道的真实点击/键盘走查未做（需运行桌面实例），结构由既有 `role="menuitemradio"` 契约用例钉住。

### Chat 页图标切换 Reicon Duotone 字重（2026-09-12，已交付）

- Chat 页 20+ 组件的图标 chrome（侧栏导航/搜索/折叠、会话行悬停操作、输入区附件/录音、发送/停止、权限与模型菜单、分组头、会话搜索、转写工具栏、技能面板、Agent 城市工具栏、记忆抽屉、header 小程序快捷菜单等）从 Outline 切换为 Reicon 官方 Duotone（`currentColor` + 50% 次层，主题继承）；项目会话视图的 header（搜索/文件面板/设置）与文件树复制、项目重命名/删除菜单、会话标题编辑一并跟随。
- 用户逐项指定的字形：发送→`plane2-duotone`、附件→`paperclip-duotone`、技能→`reorder2-duotone`、Agent→`vacuum2-duotone`、header 小程序→Grid 的 duotone（squares）、设置入口→`tuning-square2-duotone`、计划模式→`circle-arrows-down-duotone`、手动模式→`handshake-duotone`、全部小程序 CTA→`list-duotone`；其余 chrome 图标用精确 duotone 或目检过的同概念替代（CalendarDays→calendar、More→more-h、EyeSlash→eye-closed、ThumbsUp→like、PenLine→pen2、MagicWand→wand3、Files→docs、Video→camera-record、Crosshairs→target、TriangleWarning→alert-triangle 等）。小程序快捷菜单的行箭头（ArrowRight）与收藏星标（Star）同为 duotone；`StarOff` 无官方 duotone 字形，按回退规则保留线性。
- 生成管线扩展：`scripts/generate-duotone-icons.mjs` manifest 为唯一采用入口（当前 71 项），并新增产出 `apps/desktop/src/lib/icons/duotone/components/<Name>.svelte`（与 reicon-svelte 同 props 契约，`weight` 接受但忽略），组件仅由脚本生成、随 manifest 增删同步清理。
- 字重边界（DESIGN.md Foundations 已更新）：duotone 覆盖展示位与 chat 页图标 chrome；无官方 duotone 的字形（Check/X/Plus/Minus/箭头/加载等）、对话流内状态信号（成功/失败/警告标记、activity 工具类型 14px 行内图标）与 XCircle（与设置页搜索清除保持一致）保留线性 Outline。
- 验证：`svelte-check` 0 错误 0 警告、desktop vite build 通过、UI 契约测试全绿（GroupHeader 守卫断言同步到 duotone import）、隔离预览实例实测侧栏五枚导航图标、发送/停止按钮、项目会话 header、小程序快捷菜单（搜索/行箭头/星标/全部小程序 CTA）渲染正常；完整桌面冷启动走查未做。

### 对话 Header 标题优先（2026-09-12，已交付）

- 普通 Web 对话仅显示标题；外部对话在标题后以次级文字显示完整渠道名称，取消首字母胶囊和斜杠。
- 项目 Header 先显示会话标题，项目名作为后置次级文字；移除斜杠和项目类型标签。长标题和来源在各自宽度内截断，沿用明暗主题 token 与原生窗口拖动区域。

### 会话右键菜单脱离侧栏层级（2026-09-12，已交付）

- 会话菜单与关闭遮罩使用 Bits UI Portal 挂到 `body`，完整覆盖聊天区域，不受侧栏的裁剪或层叠上下文限制。
- 根因属于 CSS 层级隔离。此前的材质守卫只排除了 `backdrop-filter`，未覆盖侧栏自身的 stacking context；新增 Portal 结构守卫，并用真实 ConversationRow 组件验证右侧菜单项的命中结果由聊天面板变为菜单项。

### 侧栏右键菜单被裁剪修复：侧栏玻璃材质移到 ::before 层，fixed 菜单浮回最上层（2026-09-12，已实现）

- **症状**：左侧会话列表右键菜单（重命名/复制 session 路径/删除等）在侧栏右边缘被硬裁掉，菜单右半截不可见（用户截图圈出）。
- **根因**：在途玻璃材质改动把 `backdrop-filter`（`--sidebar-material-filter`）直接挂在 `.chat-sidebar` 元素上。带 `backdrop-filter` 的元素会成为 `position: fixed` 后代的 containing block 并以自身 `overflow: hidden` 裁剪它们——于是按视口坐标定位的 `.row-menu` 被困在侧栏盒子里，超出侧栏宽度的部分全部被裁。降级模式（低性能/减弱透明度）下 filter 为 none，菜单反而正常，行为随模式漂移。同机制也影响侧栏内其它 fixed 浮层（如 `.row-menu-backdrop` 只盖住侧栏而不是全窗）。
- **修复**：侧栏材质移到 `.chat-sidebar::before` 层（元素本身 `background: transparent` + 显式 `z-index: 0` 提供 stacking context——原 backdrop-filter 本就隐式创建了 stacking context，浮层与悬浮 chrome 的层序不变）；三处降级覆盖（低性能/减弱透明度/提高对比度）同步改指向 `::before`。合成结果不变：backdrop 采样内容与「先模糊后叠 tint」的顺序都与原来一致。
- **机器守卫**：`chat-ui.test.mjs` 侧栏材质用例改为钉住新结构——`.chat-sidebar`/`.settings-sidebar` 元素本体禁止出现 `backdrop-filter`（不跨花括号的精确正则）、材质/降级覆盖必须落在 `::before` 层；顺带修正三处钉住旧结构的断言。
- **验证**：`chat-ui.test.mjs` 240/240、`svelte-check` 0 错误、desktop vite build 通过；无头 Chrome 加载真实 `styles.css` 的结构 harness 截图确认菜单完整浮出侧栏边缘并盖在聊天区之上，「去掉 ::before」对照像素 diff 42%（材质层确认在渲染）。

### 运行状态胶囊与进度卡片去重：思考流式输出时不再叠显示「Thinking...」（2026-09-12，已实现）

- **症状**：回合运行中，状态玻璃胶囊显示硬编码英文「Thinking...」，紧挨其下「运行进度」卡片里就是正在流式输出的思考过程原文——同一件事上下说两遍（用户截图圈出）；中文界面里还混入英文文案。
- **根因**：SSE 桥接层（`src/routes/api/stream/+server.ts`）把频道适配概念照搬成了文本帧：`setTyping(true)` 写死发 `status: "Thinking..."`，`respond(text, false)` 把工具/子代理进度以 `_→ label_` 文本帧发出；而这些信息在桌面端已经全部通过结构化事件（`thinking_delta`、`runner_event` 的 activity）渲染进过程卡片。Web 端从未消费 `status` 帧，只有桌面端把它显示成胶囊文本。
- **修复**：SSE 路径不再发出任何文本 `status` 帧（`setTyping` 置空、`respond` 非 log 分支不再写帧——打字指示是频道适配器概念，SSE 客户端有自己的阶段胶囊与思考卡）；桌面端删除死掉的 `onStatus`/`status` 帧处理；状态胶囊只在「已发送但过程卡片尚无内容」的空窗期显示（本地化阶段文案：正在执行…/识别图片中…等），思考或工具活动一旦出现即由卡片接管，胶囊隐藏。
- **机器守卫**：`chat-ui.test.mjs` 新增契约用例——胶囊必须被 `!liveSections.process.length` 门控、`conversationTurn.ts` 与 stream 路由不得再出现 `status` 帧；删除守护旧通道的过时用例。
- **验证**：桌面 tsx 批次 281/281、UI 契约批次 250/250、`test:desktop-chat` 289/289、stream 路由 3/3、`svelte-check` 0 错误、根 Web 与 desktop vite build 通过。**未做**：真实模型回合的冷启动走查未执行（需中断在用服务并消耗真实调用），胶囊隐藏逻辑由契约用例钉住。


### 液态玻璃位移撤回：玻璃材质统一到 --glass-* 三档体系，面板直边恢复（2026-09-12，已实现）

- **症状**：顶栏底边、底部悬浮输入卡与各玻璃卡片的边缘呈缓慢波浪线（用户截图），不是直线。
- **根因**：在途的液态玻璃改动把 `feTurbulence+feDisplacementMap` SVG 滤镜经 `filter: var(--liquid-glass-distortion)` 套在 9 处材质层（`::before`）上；CSS `filter` 作用于图层自身渲染的全部内容（含边缘），低频噪声把直边推成 ±12px 波浪。
- **方案取舍**：把位移挪进 `backdrop-filter`（只扭曲透过的背景、保住直边）是标准做法，但离屏 WKWebView 四样张实测证明 WebKit 对含 SVG `url()` 的 backdrop-filter **整链丢弃**（解析通过、`CSS.supports=true`、`@supports` 探测不到），连 blur 都不剩；Chromium 是唯一支持方。用户拍板：简化为纯磨砂（blur+saturate）。
- **修复**：9 处材质层的位移滤镜全部移除；连同 `LiquidGlassFilters.svelte`、`--liquid-glass-*` 双主题变量、styles.css 末尾一处 `TEMP DIAGNOSTIC v2` `!important` 覆盖一并删除；被同一改动改成第二套体系的面板（chat-header、composer、plan-card、thinking-card、file-menu、prompt-navigation-preview、row-menu）统一回归守卫描述的 `--glass-*` 三档材质（surface 74%+blur32 / popover 80%+blur28 / chrome 80%+blur40 + 边缘高光 + 双档阴影）；进行中推理（thinking-card）为玻璃卡、完成态（turn-process）维持无边框透明折叠条。
- **机器守卫**：既有 `chat-ui.test.mjs` 玻璃材质/密度/降级/backdrop-root/turn-process 守卫全数恢复通过——本问题正是该改动违反这批守卫所致（5 条红用例）；CLAUDE.md 新增 pitfall 48（滤镜扭曲承载层直边；WebKit 对 backdrop-filter 含 SVG 引用整链丢弃、`@supports` 探测不出）。
- **反馈追加（同日）**：`turn-files-card` 文件结果卡接入 popover 档材质（`--glass-popover-bg` + blur28，与输入框同色），不再隐入背景；导航预览卡 blur 失效根因为导航主机 `opacity:.38/.72` 构成 backdrop root（预览卡只能采样空内容、整卡还被压淡），透明度移至标记子元素后预览恢复全不透明度 + 真实磨砂；文件行图标从通用 File 换成按扩展名的文件类型图标 + 仓库语言色（复用 `fileIcons`/`fileKindIcons` 体系，与文件面板、工件面板一致，`.turn-file-row > .reicon` 读 `--file-color`）。
- **验证**：桌面 node 批次 250/250、chat-ui 240/240、tsx 逻辑批次 199/199、`svelte-check` 0 错误、vite build 通过；离屏 WKWebView（与桌面壳同引擎）对真实 dev server 与磨砂材质 harness 截图，确认 header/composer/卡片/菜单边缘均为直线、磨砂与边缘高光正常。**未做**：正在运行的 v2.9.47 实例仍是旧构建，需重建重启后才能看到新材质（未主动中断在用服务）；cargo 批次未跑（本次未触 Rust 代码）。

### 自动任务会话视图修复：工具轨迹可见、等待审批语义诚实、弹窗布局不再塌陷（2026-09-12，已实现）

- **症状**：自动任务页「会话」弹窗里，Project 定时任务（每日 08:30 AI 日报）只显示一条 EVENT 输入、没有任何输出；Telegram 定时任务（08:00）的会话里 assistant 回复渲染成空气泡加一条竖线；执行历史把卡死在审批上的运行记成「已完成」。
- **根因（三个独立问题叠加）**：
  1. **输出真空**：`buildDesktopTaskSessionMessages`（`src/lib/server/app/desktopTasks.ts`）只保留带文本的 user/assistant 消息，toolCall-only 的 assistant 消息和 toolResult 全部被过滤。08:30 那次运行真实执行了（拉日报、写文章、跑构建），最后一步 `host_build_file` 触发 Host Bash 审批后以 `stopReason=waiting_for_approval` 挂起，最终文本从未产生——transcript 里只剩工具调用记录，再被过滤就只剩输入。
  2. **状态说谎**：`events.ts` 的 `runLeasedEvent` 只要执行函数正常 resolve 就 `markCompleted`，不区分 `waiting_for_approval`；挂起请求 1 小时 TTL 过期后被删除，运行永远无法恢复，UI 却报「已完成」。
  3. **布局塌陷**：`.task-session-detail` 是 flex column，`.message-row` 自带的 `margin: 0 auto` 使 stretch 失效，`width: auto` 让行 shrink-to-fit；assistant 回复是整块 ```` ```txt ```` 代码块（`pre` 是 `min-width:0` 的滚动容器），被压成约 1 字符宽、一字一行的「竖线」。
- **修复**：
  1. 会话投影保留工具轨迹：一次运行投影为一个 assistant 轮次，toolCall/toolResult 配对成 `DesktopConversationActivity[]`（label 取 arguments.label、结果文本截断为 summary、时长/错误态齐全，无结果的调用闭合为 error），thinking 依旧不外泄、工具参数永不进 summary；客户端 `normalizeDesktopTaskSession` 透传 activities，纯活动消息（无文本）不再被丢。配合前端现成的 `TurnProcess`/`RunActivity` 渲染成「过程 + 答复」。
  2. 租约新增 `waiting_approval` 终态（`markWaitingApproval`）：运行挂起时租约记等待而非完成，定时器的 run-lock 照常释放（排程继续）；桌面契约与中英文案（等待审批 / Waiting for approval）与状态色同步补齐。
  3. 无人值守运行（isEvent + fresh 的自动化事件）不再挂起成僵尸：Host Bash 在创建审批请求前直接拒绝（`unattendedDenials`，父运行与子代理同享），通用 broker 路径经 `onApprovalRequest` 新增的 `"deny"` 处置拒绝且不落请求；模型拿到明确的拒绝文本后继续执行并在最终答复里报告被跳过的步骤。挂起语义本身（issue #48）对有人值守的会话保持不变，durable 尝试的 defer 也不受影响。
  4. `.task-session-detail .message-row.assistant { width: 100% }`：assistant 行保持全宽横向滚动，只有用户行收缩。
- **机器守卫**：`desktopTasks.test.ts` 4 条投影用例（文本提取、活动配对、挂起运行可见且参数不泄漏、legacy JSON 块）；`api.test.ts` 活动透传用例；`eventsLeaseStore.test.ts`/`events.test.ts` 挂起租约记 `waiting_approval` 且 run-lock 释放；`bashApprovalWait.test.ts`/`toolRuntime.test.ts` deny 处置不终止循环、不落请求；`chat-ui.test.mjs` 结构断言禁止 assistant 行 shrink-wrap（pitfall 16c 的第二次出现，守卫成为必选项）。
- **验证**：相关服务端套件 92/92、`test:desktop-chat` 289/289、`test:projects` 83/83、`test:service-bootstrap` 21/21、`svelte-check` 0 错误、SvelteKit 与 desktop vite build 通过；用真实落盘的 08:30 运行归档跑新投影，输出「输入 + 6 条工具活动（含审批请求摘要）」；空气泡用无头 Chrome 加载真实 `styles.css` 与真实数据做了修复前后截图对比。**未做**：本机正在运行的服务（v2.9.47）仍是旧构建，需重建重启后弹窗才会呈现新投影与等待审批状态（未主动中断在用服务）；工作区中在途的液态玻璃改动自带 5 条 `chat-ui.test.mjs` 失败用例，与本次改动无关。

# Molibot Features

### Chat 界面全量落地 macOS 液态玻璃效果与深浅色模式深度调优（2026-09-12，已实现）

- **背景与目标**：基于 Lucas Romero 的 macOS Liquid Glass 物理光学模拟效果，将 Chat 核心界面的浮动与交互层全面改造为高质感的液态玻璃材质，并深度兼容与优化暗色模式。
- **全局 SVG 滤镜 (`LiquidGlassFilters.svelte`)**：
  - 在 `App.svelte` 根部挂载不可见的全局 SVG Filter 定义。
  - **浅色滤镜 (`#liquid-glass-distortion`)**：基于 `feTurbulence` (0.002 0.006) + `feSpecularLighting` (#ffffff 光源) + `feDisplacementMap` (scale 24)，营造通透清澈的边缘微扰折射。
  - **暗色滤镜 (`#liquid-glass-distortion-dark`)**：降低折射 scale (16)，采用微蓝紫冷调光 (`rgb(210, 225, 255)`)，调高 `specularExponent` (120)，彻底消除暗色背景下高光粗糙泛白的问题。
- **5 个重点场景的全面落地**：
  1. **右键菜单弹出窗口**：正文与代码/文件右键菜单（`.file-menu`）改用液态玻璃背景与多层边缘内高光。
  2. **Chat 多轮对话预览**：右侧定位时间轴悬停预览卡片（`.prompt-navigation-preview`）接入液态折射光泽与景深阴影。
  3. **左侧 Session 会话右键菜单**：会话操作弹窗（`.row-menu`）加入液态材质与高光边缘。
  4. **状态气泡与思维卡片**：运行状态进度条外壳（`.turn-process`）与思维链展开卡片（`.thinking-card`）接入统一的液态玻璃微质感。
  5. **审批计划卡片与顶部/底部悬浮条**：计划决策卡（`.plan-card`）、顶部浮动标题栏（`.chat-header`）与底部悬浮输入框外壳（`.composer`）全面升级为液态玻璃微光折射层。
- **机器守卫与验证**：
  - `svelte-check` 0 错误 0 警告。
  - `vite build` 生产打包测试通过。
  - `chat-ui.test.mjs` 248/248 项用例全绿通过。

### 剪贴板粘贴图片：名称唯一化 + 截图多格式表示只留一张（2026-09-12，已实现）

- **症状**：粘贴截图时输入框出现两个附件，两个都叫 `image.png`；连续粘贴两张图时两次都叫 `image.png`，附件条上无法区分，也担心上传落盘时互相覆盖。
- **根因**：`clipboardImageFiles` 只对**空文件名**做多格式去重（原注释「Safari 的 png+tiff」），其余条目一律原样透传。而 macOS 的截图剪贴板里同一张图以 9 种格式存在（`screencapture -c` 后 `osascript -e 'clipboard info'` 实测：PNGf/AVIF/8BPS/GIF/jp2/JPEG/TIFF/BMP/TPIC），WebView 为这些**剪贴板数据**条目生成的占位名是 `image.<ext>`——名字非空，于是 png 与 tiff 两个条目都被当作「两张不同的图」收下；同理，两次粘贴的截图都拿同一个占位名。占位名不携带身份信息，不能用来判断「是不是两张图」。
- **根修（共享 helper）**：`clipboardImageFiles` 按**名字能否证明身份**重新分组。空名或匹配 `image.<ext>` 占位形态的条目是「同一张图的格式表示」，只保留优先级最高的一种（png > jpeg > webp > gif > 其它）；带真实文件名的条目是独立的文件，全部保留。另外：粘贴板同时给出真实文件和它自己的字节副本时（Finder 复制图片即如此），保留文件、丢弃表示，避免同一张图出现两个附件。命名上，表示条目按会话内递增序号命名为 `image-1.png`、`image-2.png`（连续粘贴不再重名，序号循环跳过本次已用名），真实文件名原样保留、仅在同一次粘贴内重名时追加 `-2`、`-3`。所有分辨率的扩展名按 MIME 取（tiff 不再被错标成 `.png`）。
- **机器守卫**：`api.test.ts` 7 条剪贴板用例——文本/PDF 项不受影响、多格式表示只留一张、截图 `image.png`+`image.tiff` 只留一张、连续两次粘贴得到不同名字、多文件粘贴各自保名、真实文件优先于其字节副本、同一次粘贴内重名文件互不覆盖。
- **验证**：`api.test.ts` 107/107、`chat-ui.test.mjs` 236/236、`svelte-check` 0 错误 0 警告、`vite build` 通过。**未做**：真机粘贴走查（本环境无法自动按键，`osascript` UI scripting 未授权），`image.<ext>` 占位名是按 WebKit 行为建模并用剪贴板实测格式列表佐证的，需在桌面端真实粘贴一次确认。

### Chat 页 macOS 化：液态玻璃材质体系 + 悬浮工具栏/输入框（2026-09-12，已实现）

- **背景**：chat 页此前所有浮层都是同一张不透明 `--card-bg` 卡片加一档阴影，弹窗、审批、计划、思考态都没有材质层次，整体观感偏 Web。工作区里已有一份上次中断的半成品：`DESIGN.md` 的 `§Chat glass materials` 契约与 `styles.css` 的六个 `--glass-*` token 都已写入，但**全仓 0 处引用**——契约落地了，屏幕上一个像素没变。本次把材质真正接到表面上并补齐契约未覆盖的部分。
- **材质接线**：审批/决策卡、计划卡、composer 及其上方整叠条（排队消息、待发附件、录音条、编辑条、无模型提示、错误条）、顶栏、运行态胶囊，以及全部 chat 浮层菜单（模型/权限菜单、斜杠建议、溢出菜单、命令面板、Mini Apps 快捷菜单、提问导航预览）统一走 `--glass-surface-bg` / `--glass-popover-bg` + `backdrop-filter` + `--glass-edge`；大面（卡片、composer）用 30px 模糊与 float 档阴影，小件用 24px 与 chip 档——大面读作更厚。静态区（正文、气泡、侧边栏、设置）保持不透明。
- **不透明度是清晰度下限，不是口味**：首版按 78% 配，弹窗盖在转写上时文字看不清，观感就是「纯半透明」而不是磨砂。macOS 承载文字的材质（popover/menu/toolbar）实际是 90–97% 不透明——磨砂感来自「很重的模糊 + 很低的透出量」，不是让内容透过来。现为：大面 90%、承载文字的小菜单与胶囊 93%、悬浮 chrome 92%，模糊 24–36px；上下限都写了守卫，防止再次漂移。
- **backdrop root（本轮真正的根因）**：`backdrop-filter` 会让元素成为 backdrop root，其子孙的 `backdrop-filter` 只能采样该 root 内部的内容（Filter Effects §Backdrop Root）。材质加在 `.composer` 与 `.chat-header` 上之后，正好把最常用的一批弹窗的模糊杀掉了——模型菜单、权限菜单、斜杠建议在 `.composer` 里，Mini Apps 快捷菜单在 `.chat-header` 里，它们都悬停在父级盒子之外、转写上方，于是在父级里找不到任何可模糊的内容，退化成纯半透明、下面的字原样透出。修复：把这两个父级的 `background` + `backdrop-filter` + `box-shadow` 整体挪到 `::before` 层（元素本身不再产生 backdrop root），并给宿主 `z-index: 0` 提供 `z-index: -1` 所需的层叠上下文——**不能用 `isolation: isolate`**，它本身就在 backdrop-root 名单里，会把 bug 原样装回去。带 1px 边框的宿主还要让该层覆盖到 border box（`inset: -1px`），否则半透明描边会直接压在原始内容上形成一圈接缝。守卫：`chat-ui.test.mjs` 新增「包含弹窗的宿主不得自己带 backdrop-filter」断言。
- **边缘高光改为随主题**：`--glass-edge` 原先写死 `rgb(255 255 255 / 55%)`，挂到深色家族就是一道硬白线；改由项目已有的逐家族 `--glass-border-light`（浅色 42–72% 白、深色 14–25%）驱动，一处声明四个家族 × 明暗自动正确。玻璃深度同样改为按明暗（而非家族）在 `:root[data-resolved-appearance="dark"]` 下加深一次。
- **真·悬浮（布局变更）**：顶栏与输入框移出 chat 列的正常流，改为绝对定位浮在转写上，内容真正从下面滚过去；顶栏去掉硬底边（改由模糊分隔），输入框上方加 26px 渐隐带（滚动边缘效果，且刻意停在 composer 顶边，让玻璃背后仍有真实内容可采样）。两者各自用 `--chrome-header-bg` / `--composer-bg` 经 `--glass-chrome-opacity` 混色，因此顶栏的「窗口失焦」投影继续生效。
- **高度预算而非常量**：转写用 `--chat-header-h` / `--composer-h` 预留上下空间，dock、提问导航、操作提示条按 `--composer-h` 上移。`--composer-h` 是 `ChatInputArea` 用 `ResizeObserver` 对整个 footer 的实测值（输入行数、排队条、附件、横幅都会撑高），随浮动的传入 prop 决定是否发布，卸载时清除，避免残留高度。
- **动效**：`popover-in` / `command-palette-in` 入场改为材质化——opacity + transform + `filter: blur(6px → 0)` 同帧解析，末帧 `blur(0)` 且不加 `forwards`（避免元素永久成为子元素的包含块）；浮层 `transform-origin` 锚到触发源。**仅做入场**：这些浮层是条件渲染，卸载时没有可过渡元素，出场保持瞬时，已在 DESIGN.md 写明而非假装对称。
- **思考/运行态**：合并两个互相打架的指示器——原先「1.4s 呼吸圆点」与下方流程卡里「1s alternate 三竖条」同时动画。现在运行态是一枚玻璃胶囊，只有一道 `translateX` 光泽扫过（Apple Intelligence 手法，纯 transform 不触发重绘），wave 归位到它描述的步骤（流程卡与活动行）；wave 本身改为共享周期 + 负延迟，读作一道行进波而非三次独立闪烁。`prefers-reduced-motion` 下竖条保持静止满高 crest（仍编码「运行中」），而不是 `animation: none` 卡在中间态。
- **降级**：`data-reduced-transparency`、`data-performance="low"`、`prefers-contrast: more` 三档同时把 `--glass-surface-bg` 置为 `--card-bg` **并**把 `--glass-chrome-opacity` 提到 100%——只去掉模糊会留下半透明长条压在滚动文字上，比两端都差。
- **验证**：`svelte-check` 0 错 0 警、`vite build` 通过；desktop Node 结构测试 248/248（含新增 5 条守卫：材质必须成对出现、包含弹窗的宿主不得自带 backdrop-filter、不透明度与模糊的下限、悬浮高度预算、入场与降级），chat TS 测试 42/42。**未做**：真实 WebView 的冷启动走查（本环境无头浏览器与 Tauri 窗口均不可用），滚动穿透与 `--composer-h` 的实测需人工确认。

### 桌面端合并「执行与权限」「执行环境」为单页（2026-09-12，已实现）

- **合并**：桌面设置删除独立「执行环境」（sandbox）分区，沙箱后端、可用性诊断与高级限制（env 注入/网络/文件系统规则）整体并入「执行与权限」页（`ExecutionPermissionsSection` 一个组件，`SandboxSection.svelte` 删除）；设置侧栏系统组收敛为 运行环境/执行与权限/插件/诊断 四项，命令面板 `settings.sandbox` 目标同步替换为 `settings.executionPermissions`。
- **排版修复**：执行模式卡片固定 2×2（原 auto-fit 在 720px 栏内折成 3+1 失衡）；「完全访问的范围」由右侧挤压长行改为卡片底部说明块；「沙箱后端」组描述承接适用范围说明、诊断行并入同组（运行诊断按钮移至组头）；「高级限制」折叠改为透明披露并对齐 720px 内容栏（原为横跨窗口的实底长条）；页面统一单一保存底栏（模式与沙箱策略任一改动出现，一次保存按需分别提交，放弃同时还原）。
- **清理**：删除失效 i18n key（executionEnvironment*、sandboxHint、sandboxPreset* 预设族、sandboxEnabled/InitFailure/Diagnostics 等约 60 条，两种语言），新增 `settingsSave`；合并页描述更新为中英双语。
- **验证**：desktop `svelte-check` 0 错 0 警、`vite build` 通过、commandSystem 单测 8/8；浏览器预览连真实服务只读走查：合并页深/浅主题与中/英文渲染、高级限制展开对齐、模式切换出现保存栏、放弃更改正确还原（未写入任何服务端设置）。

### 统一权限模式第二轮复审修复：代理白名单时效、Auto 布局墙、子代理审批升级、draft 默认刷新（2026-09-12，已实现）

- **P1 改域名限制后共享代理仍用旧白名单**：基础设施去重键此前只含静态 knob + 代理存在性，而 SDK 的共享代理过滤器读的是管理器全局 config——先允许全部再收紧域名后，沙箱命令仍按旧白名单放行（复现：仍返回 200）。修复：`sandboxInfrastructureKey` 纳入完整网络配置（allow/deny 域名排序后参与），网络设置变更触发管理器重初始化；文件系统仍走逐命令 customConfig（并发句柄的 workspace 差异继续互不干扰）。守卫：infra key 语义反转后的纯函数测试 + 「allow-all → 收紧域名」两段 prepare 断言第二次 initialize 携带新 allowlist。
- **P1 Auto 写外部文件被输出布局检查拦住**：路径守卫放开后，write 的第二层 `Absolute output paths must stay inside the Project root or runtime scratch root` 仍在。修复：该层包含性检查同样按 `hostWideAccess`（Auto）跳过，受限模式两层照旧（测试分别钉住两层错误）。守卫：write 工具带 outputLayout 的 Auto/受限对照测试。
- **P1 子代理沙箱拒绝无法升级审批**：绑定环境的 shell 包装只返回退出码和输出，丢掉 `sandboxApplied`/`warning`，bash 无法识别沙箱拒绝（复现：审批请求数 0）。修复：完整透传执行元数据；沙箱拒绝照常升级为 Host Bash 审批请求并挂起。守卫：脚本化环境返回 `Operation not permitted` + `sandboxApplied: true` → 恰好一个审批请求 + 挂起文本。
- **P2 draft 默认模式可能过期**：只在服务地址变化时读取一次。修复：每次新开 draft（draftMode 翻转）与收到设置变更事件（未主动选择时）都重新拉取全局默认；用户在 draft 中显式选择过的值不被覆盖。守卫：chat-ui 结构守卫补两条刷新条件。
- **验证**：受影响服务端测试 256/256 + 外部适配器契约 3/3；desktop `svelte-check` 0 错 0 警、chat-ui 233/233、api.test 103/103；`vite build` 通过；重建产物冷启动冒烟（health 200 → execution-default GET/PATCH → sandbox GET → kill 重启恢复 200）通过。

### 统一权限模式复审修复：子代理真沙箱、Auto 文件全host、draft 继承、Provider 配置所有权、提示词契约（2026-09-12，已实现）

- **P1 子代理 bash 未接沙箱（review 复现）**：`createBashTool` 走 `toolDefToAgentTool` 的 legacy ctx，`shell.run` 直接 `execCommand`，`executionTarget` 只是摆设——沙箱不可用时子代理照样在宿主建文件。修复：`toolDefToAgentTool`/`createBashTool` 接受绑定执行环境，`createBashDefinition` 用 `bindExecutionEnvironment`（继承父尝试策略）绑定后传入——沙箱目标真沙箱、全自动真宿主、Plan 显式失败（不再静默逃逸宿主）；子代理 read/write/edit 同步继承 `hostWideAccess`。守卫：注入式后端路由测试 + 沙箱不可用组合复现（拒绝且不落盘）+ subagent.ts 结构断言。
- **P1 Auto 文件工具仍被 workspace 根墙拦住**：只取消了 denyWrite，`createPathGuard` 的 approved-root 检查仍拒绝外部路径。修复：`createPathGuard` 增加 `hostWideAccess`（Auto 时跳过根限制，保留 memory gateway / 全局 profile 两类结构路由守卫），主路径 ctx.fs 与 read/write/edit 及子代理同名工具按有效策略传参——文件工具与命令服从同一份策略。守卫：path 守卫单测 + write 工具在 Auto 写外部路径成功 / 受限模式仍拒绝的对照测试。
- **P1 新会话无条件写会话覆盖**：`draftPermissionMode` 硬编码初始值且 `onDraftSessionCreated` 无条件保存，全局默认改了新会话不跟随。修复：draft 进入时从 `/api/desktop/execution-default` 读取真实默认（新增 `loadDesktopExecutionDefault` 客户端），只有用户在 draft 中主动选择（`draftPermissionModeTouched`）才落会话覆盖，否则继承并在来源行显示「继承自全局默认」。守卫：chat-ui 结构守卫锁定 touched 条件与未触碰分支不含保存调用。
- **P1 后端句柄未隔离真实沙箱配置**：Anthropic provider 的 `initialize` 以完整 config 为去重键，并发时第二个句柄等第一个的初始化 Promise 却应用不上自己的配置。经 SDK 源码核实：`wrapWithSandbox` 第三参支持逐命令 `customConfig`（文件系统逐命令生效），网络代理过滤读全局 config 而域名限制本就是全局设置（各句柄一致）。修复三件套：(1) `sandboxInfrastructureKey`（allowLocalBinding + 代理是否需要）作为去重键，句柄间差异不再触发 reset 抢占；(2) `prepareToolSandboxExecution` 把本句柄 effective config 传入 `wrapWithSandbox` customConfig，wrapped 命令自带配置、与全局状态解耦；(3) init→wrap 以模块级互斥串行（执行仍在锁外，并发保持并行）。守卫：infra key 纯函数测试 + pluggable provider 捕获「wrap 收到本句柄 config」契约测试。
- **P2 静态提示词与全自动冲突**：缓存稳定前缀里的「Bash 在沙箱中执行、宿主操作须请求审批 `bash(command, hostApproval=…)`」教学会让 Auto 模型主动停下等一张永远不会来的卡。修复：删除静态 `host-tool-approval` section（含 pipeline 第 4 步的指向），沙箱→宿主访问契约移入 manual/accept_edits 的逐轮 runtime instructions（Auto/Plan 不含），bash 工具描述改为模式中立；modeInstructions 的 Auto 行显式加「不要请求/等待审批、不要把命令描述为沙箱内」。守卫：modeInstructions 测试（受限模式含契约、Auto 无 hostApproval 教学、四模式互异）+ prompt.ts 源结构守卫（静态前缀不再含审批教学）。
- **验证**：受影响服务端测试 269/269（approvalSuspension harness 10/10 连续三轮稳定）；desktop `svelte-check` 0 错 0 警、chat-ui 结构守卫 233/233、api.test 103/103；`vite build` 通过。

### 统一执行权限模式：一套四模式，全自动=完全访问（2026-09-11，已实现，issue #49）

- **统一模式**：产品只保留一套执行权限模式（计划/手动/接受修改/全自动），设置默认值与对话窗口覆盖共用同一套名称、说明与运行时策略；会话覆盖按原五级链（Session → Project → Bot 实例 → Agent → 全局默认）解析，`resolveEffectivePermissionMode` 现同时返回决策来源（session/project/instance/agent/global），`/api/desktop/session-permission` GET 透出 `source`，composer 权限菜单底部显示「来源：本会话覆盖/继承自…」。删除 `clampModeForChannel`：渠道不再把 Plan/Manual 钳制成 Accept Edits（Plan 各渠道只读可守、Manual 走既有 defer/挂起审批路径），杜绝无审批面渠道上的静默放宽。
- **全自动=完全访问（行为变更）**：`decidePermission` 矩阵中 auto 全行 allow——宿主命令、越界写入、MCP/第三方调用、Mini App/插件安装等管理操作不再产生审批卡或 `waiting_for_approval`；high/critical 工具的强制 broker 门槛在 auto 下跳过。删除旧「半自动」补丁链：`liftSandboxForPermissionMode`（Auto 放开沙箱域名）与 `autoApproveSandboxEscalation`（沙箱拒绝后解析输出再转宿主重跑）整体移除——auto 在命令启动前就选择宿主执行，不经沙箱、无二次副作用；受限模式的「会话级批准宿主回退」与 Host Bash 审批卡路径保持不变。`.env*` 凭证文件硬保护（toolPolicy preflight）不属于审批门，全访问下继续保留。
- **共享执行后端边界**：新增 `src/lib/server/agent/exec/executionBackend.ts`——`ExecutionBackend`/`BoundExecutionEnvironment` 共享入口统一拥有命令执行、输出、终态、取消与环境生命周期；`HostExecutionBackend`（直接宿主执行 + env 文件凭证注入）与 `AnthropicLocalSandboxBackend`（provider 包装、依赖检查、fail-closed 收敛在适配器内）按有效模式的 execution target 选择；`bindExecutionEnvironment` 把后端+workspace 绑定到单次尝试，模式/后端更改只影响下一次尝试。Plan 模式绑定显式 no-execution 环境（拒绝而非静默宿主回退）。bash/文件工具/审批判定/子代理/提示词/UI 全部读取同一份 `EffectiveExecutionPolicy`（mode + source + executionTarget + 适用沙箱限制）。
- **删除独立沙箱体系**：`ToolSandboxSettings` 移除 `enabled`/`initFailureMode`（sanitize 双向丢弃旧字段），沙箱是否参与执行由有效模式决定；删除 agent/instance/Project 的 `sandboxEnabled` 覆盖链与 session `preferences.sandboxOverride`；删除沙箱四档预设（locked/readonly/standard/full）与预设滑条 UI、检测/应用逻辑（desktop api + web 页）。默认沙箱网络不限制（`allowedDomains: ["*"]`），域名/文件系统/env 注入降级为「执行环境」高级设置，仅约束沙箱命令，UI 明示全自动下不适用。
- **子代理与外部适配器**：内部子代理通过 `executionPolicy` 显式继承父尝试策略（bash 执行目标与父一致）；外部 Codex/Claude Code 适配器删除独立 `codexPermissionMode`/`claudeCodePermissionMode` 配置（插件 manifest/UI 更新并 bump 0.2.2→0.3.0），改由 `policyTranslation.ts` 把会话有效模式翻译为受支持的运行时选项（Claude: plan→plan、accept_edits→acceptEdits、auto→bypassPermissions；Codex: accept_edits→approve-for-me、auto→dangerously-bypass…），无法守约的模式（如 Manual 无交互审批面、Codex 无只读）抛出明确 unsupported 错误，不再静默等待或放宽。
- **UI/渠道命令**：设置新增「执行与权限」区（全局默认模式四卡片 + 完全访问范围说明，新 `/api/desktop/execution-default` 端点）；「沙箱」区改版为「执行环境」（后端声明+可用性诊断+折叠高级限制，无开关无预设，固定底栏保存）；Agent/Channel/Web Profile 设置的沙箱覆盖改为一套四模式继承式选择；composer 权限菜单 Auto 显示「全自动（完全访问）」并显示来源行；工具展示标签（Sandbox/bash）与 runner 诊断事件改用 `executionTarget`；渠道 `/sandbox` 命令替换为 `/mode [scope] [plan|manual|accept_edits|auto|reset]`（状态含生效模式与来源）。Web 端设置页（system 沙箱开关→默认模式、渠道页沙箱开关→模式继承、sandbox 页改版执行环境）同步。中英即时切换、明暗主题与窄宽度沿用既有 token/组件体系。
- **机器守卫**：`decidePermission.test.ts` 新矩阵逐格断言（含「Auto 永不 ask/deny」「受限模式不自动放行宿主」「Accept edits 对外部效应全 ask vs Auto 全 allow」差集）；`resolvePermissionMode.test.ts` 来源标注+模式→target 推导+沙箱限制仅在参与时附带+全渠道不钳制；`executionBackend.test.ts` 注入式后端验证 workspace 绑定、输出/终态、取消、并发不串配置、能力声明决定高级设置存在性；`approvalSuspension.test.ts` 新增 7 个真实 Runner 场景（宿主直执行/显式宿主请求/denyWrite 文件/管理操作/渠道 Manual 挂起不放宽/切回受限立即生效/模式更改不复活待审批）；`tools/index.test.ts` 经真实 ToolRuntime 的 MCP third_party 对照（auto 直执行 vs accept_edits 产审批）；`externalSubagentAcceptance.test.ts` 契约更新+翻译函数用例；store round-trip 覆盖新形状（含旧字段在 sanitize 丢弃）。
- **验证（已执行的必需检查）**：服务端全树（agent/settings/approval/hostBash/app/channels/projects/sessions）1553 项测试 1552 过——唯一失败 `desktopApprovals`「lists only for requested session」经 git stash 基线核实为 HEAD 既有问题，与本线无关；其中主验收入口 `approvalSuspension.test.ts` 10/10（三既有审批挂起回归 + 七个新 Auto/受限/竞态场景）。`tsc` 相对 HEAD 基线 diff：生产代码 0 新增错误（新增错误全部位于随实现更新的测试文件，且已随测试转绿）；desktop `svelte-check` 0 错 0 警；`vite build` 通过；desktop 结构守卫 236/236（含按新执行环境契约改写的 sandbox 守卫）。隔离实例冷启动冒烟（构建产物 + 临时 DATA_DIR + 5177 端口）：`/health` 200 → `execution-default` GET 默认 accept_edits / PATCH 改 auto → sandbox GET 新形状（backend + 高级限制，无 enabled）PATCH 保存域名限制 → session-permission GET source=global / POST 会话覆盖 manual 后 source=session → kill 重启后三项保存值全部存活（round-trip 通过）。**未完成/边界**：真实 GUI 的四语言/主题/窄宽度人工点查未执行（以 svelte-check + 结构守卫 + 双语文案落地代替）；渲染后系统提示词的四模式断言由 `modeInstructions.test.ts`（四模式互异 + 关键词）与 runner 接线覆盖，未在真实模型往返中肉眼核对。
