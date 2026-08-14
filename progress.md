# 会议纪要验收返工进度（2026-08-14）

- 用户明确否决现有产品体验：UI/交互错乱、没有暂停与继续、没有真正历史记录。
- 已按 `diagnosing-bugs`、`planning-with-files`、`frontend-design` 重新开启验收：先做可失败回归，再修改状态机和 UI；不会用零散按钮掩盖领域模型问题。
- 已确认上一版计划与实现存在直接矛盾：计划把 pause/resume 列为已完成验证，实际宿主协议和原生命令均不存在这两个动作。当前完成状态已在新计划中作废并保留审计说明。
- 当前阶段：检查现有测试接缝并新增三类红测试——共享宿主动作、会议 paused 持久状态、Live/History 页面结构。
- 首轮红测 9/12：宿主 pause/resume 动作被拒绝、会议 pause 路由 404、UI 无 Live/History；另发现 paused-restart 测试漏验 pause 响应导致假绿，已先修测试本身。
- 已开始根修状态机：原生 capture 改为显式 `recording/paused/stopped`，暂停会停止接收新样本并请求冲刷当前缓冲；宿主契约、Desktop 协调器和 Panel 已加入 pause/resume；会议域加入幂等 pause/resume 与 paused 活动保护/重启中断恢复。
- Meeting Notes 页面已移除旧的永久双栏，改为“会议现场 / 历史记录”两个单列任务表面；现场页加入大计时器、暂停/继续、二次确认结束，历史页加入搜索、日期分组、列表/详情返回路径和空状态。
- 首轮静态检查：新 UI JavaScript 语法通过，Desktop Rust `cargo check` 通过。下一步修正列表投影中的时长/检索字段并跑红测转绿与 UI 设计守卫。
- 首次转绿测试暴露两处测试夹具问题而非生产失败：host requestId 误含 `.` 被合法 token 校验拒绝；runtime 的默认 200 响应不显式写 `status`。已修正夹具为合法 requestId，并按 runtime 约定把缺省状态视为 200。
- 状态机/会议域/历史搜索聚焦回归 13/13，Desktop UI 结构守卫 205/205。Mini App 设计守卫发现窄屏计时器一个裸 `54px` 字号，已删除该冗余覆盖并继续使用响应式 `clamp()`。
- 内置安装/manifest/设计基线与会议聚焦套件 40/40，Desktop `svelte-check` 0/0，原生聚焦测试通过；Root 与 Desktop production build 通过（仅既有 Vite chunk/import 提示）。全新临时数据目录成功安装 Meeting Notes `2.1.0`。
- 浏览器冷路径未能完成：Codex 应用内浏览器策略阻止访问 `127.0.0.1`，当前没有连接可用的外部 Chrome 控制。该限制已如实记录，未把源码检查或结构测试冒充视觉验收。
- 全量 Desktop suite 通过（含 205 个结构守卫、56 个 Rust 测试）；全量 Mini App suite 157/158，唯一失败仍是任务开始前已记录的 `toolAdapter.test.ts` 旧 fixture 缺少现有 `effect` / `thirdPartyHint` 字段，与本轮 Meeting Notes 无关。
- 对抗式审查修复：轮询不再抢走 History 视图；服务重启后原生 capture 可把未结束的 interrupted 会议恢复为 recording/paused；活动会议从历史查询表面排除；暂停边界立即冲刷短缓冲。
- Meeting Notes 内置版本升级到 `2.1.0`；features/prd/CHANGELOG/中英文 README 已同步。本轮实现和自动验证完成，剩余发布前人工验收是目标 Mac 上的真实麦克风 pause/resume 与中英/明暗/窄宽视觉走查。

---

# 会议纪要生产化 V1 进度（2026-08-13）

- 2026-08-14 真实硬件首轮验收发现并修复上传边界：10 秒、48 kHz PCM WAV 为 960,044 bytes，Base64 JSON 约 1.28 MiB，超过 adapter-node 默认 512 KiB。用用户保留的真实块对当前服务重放稳定得到 400 `Request body must be JSON`；隔离生产服务应用 12 MiB 有界启动限制后，同一块返回 202 并落库。桌面服务重启后协调器自动补传 4/4 块，原生待上传清零。
- Fix 收尾：根因类别为“传输边界/请求体上限未对齐”；机器守卫同时锁定启动器必须在加载 adapter-node 前设置上限，以及 body-limit 异常必须映射为 413。会议页新增转写/总结故障说明和总结中轮询；服务端新增安全结构化故障事件。Meeting Notes bump 至 2.0.1。
- 本次真实会议前三块转写成功，最后 5.7 秒块在三次尝试后为 `provider_failed`；结束 barrier 已补交，最终文本模型同样返回 `provider_failed`。音频和三段已完成文字均保留，说明上传修复成功，剩余故障属于当前 Mini App 继承的全局 STT/文本 Provider 路由。
- 最终验证：上传/会议/UI 聚焦回归 12/12、服务启动与所有权回归 45/45、production build、真实 960,044-byte 块 HTTP 重放、当前桌面服务 deep health 与 `git diff --check` 均通过；用户安装的 Meeting Notes 已更新为 2.0.1。
- 交付收口：Root 与 Desktop production build、`git diff --check` 均通过；构建只报告工作区既有的 Vite dynamic/static import 与 chunk size 提示。
- 真实冷路径通过：使用全新临时数据目录启动生产服务，安装 Meeting Notes 2.0.0，确认代理 CSP、`audioCapture` 能力投影和空会议页；同目录重启后安装状态保留。随后创建 recording 会议并再次重启，runtime 将其恢复为 `interrupted`，没有把未完成音频误报为完整纪要。临时目录已移动到系统废纸篓。
- 对抗式审查收口：长录音由 10 秒磁盘块和有限队列约束内存；上传采用服务确认后删除和幂等重试；结束 barrier 显式暴露缺块/失败块；Panel 生命周期与原生采集解耦；第三方设备能力要求用户启用；活动会议禁止删除或提前重算。
- 尚需发布前人工验收：在目标 Mac 上首次授权麦克风并完成一段真实录音，确认具体硬件输入、系统权限弹窗和现场声学效果。自动化已覆盖 WAV 时序、上传、恢复和总结链路，但不能替代真实麦克风验收。
- 宿主能力契约完成：manifest 严格声明 `host.capabilities: ["audioCapture"]`，能力显式投影到 Desktop，独立 postMessage 协议只接受 `audio.start/stop/status` 和受限标识符。
- 验证：host capability、manifest 与 Desktop projection 聚焦测试 14/14 通过。
- 原生会议采集器与 Desktop 协调器已接通：10 秒磁盘 WAV、有限 callback 队列、按序 at-least-once 上传、服务确认后删除、停止时显式提交 `expectedLastSeq` barrier；Panel 销毁不再持有录音对象。
- 音频入口同时在 Desktop 服务端复核 manifest capability，不能只靠 WebView 自报授权。聚焦 Node 测试 17/17 与 Rust `cargo check` 通过。
- 会中增量纪要已完成：每 60 秒新转写证据滚动更新临时纪要，prompt 只携带有界的上一版与最新证据；停止后仍走分层最终收敛。会议域聚焦回归 10/10 通过。
- Desktop 完整回归通过：Node/UI 208/208，Rust 56/56；`svelte-check` 0 错误/0 警告。
- Mini App 全量回归 157/158；唯一失败是本任务开始前已记录的 `toolAdapter.test.ts` 旧期望缺少现有 `effect` / `thirdPartyHint` 字段，与 Meeting Notes 改动无关。因测试命令使用 `&&`，后续 build 未执行，已拆开重跑构建。
- 对抗审查修正设备授权告知：第三方 AI/麦克风 App 统一初始禁用，Mini App 管理页在中英文中展示麦克风能力；新增安装策略回归。
- Root 与 Desktop production build 均通过（仅保留既有 Vite dynamic/static import 提示）。
- 用户确认 V1 先做线下面对面会议；后续系统音频作为第二个采集适配器，不改变统一时间线和下游领域模型。
- 已读取 planning-with-files 规范并建立独立计划章节；未覆盖历史 planning 内容。
- 已确认当前关键阻塞：iframe 持有录音生命周期、原生短语音实现全程驻内存、Mini App AI 仅文件转写、bridge 无音频采集动作。
- 已确认不能复用现有无副作用 composer bridge 承载采集；Phase 2 将建立独立 host-capability request/receipt seam，并由 manifest 声明授权。
- 当前进入 Phase 1：先用临时 SQLite 回归锁定多音轨 schema、停止 barrier、缺口和重启恢复，再改生产实现。
- Phase 1 已决定使用 `tracks.expectedLastSeq` 作为停止 barrier；旧 v1 数据不做兼容读取，首次 v2 启动只备份旧库/音频后启用新格式。
- Phase 1 红测试已建立并按预期 0/6：当前 API 不返回 track、没有 v2 schema backup、finish 不具备 barrier、重启仍终态化处理、UI 仍直接构造 `MediaRecorder`。下一步实现 v2 runtime 使前五项先转绿，host capability UI seam 在 Phase 2 转绿。
- Phase 1 runtime 已完成，聚焦测试 5/6 通过：多轨 chunk/幂等、显式缺口、finish barrier、孤儿转写恢复、v1 备份退场、级联音频删除均转绿；唯一红项是 Phase 2 预先锁定的 host-capability UI seam。

## 调查错误

- 两次更新 planning 文件时沿用了摘要里的英文/简写标题，patch 未命中；均按文件真实中文标题重试，无产品代码影响。
- `cargo fmt --check` 暴露工作区既有多文件格式差异，因此没有全量格式化以免覆盖用户改动；改为只手工整理本次 Rust 注册项并独立运行 `cargo check`。首次检查通过但提示一个本次未使用字段，已删除。
- 首轮 Desktop `svelte-check` 发现一个 Mini App 测试 fixture 未补新增的显式 `hostCapabilities` 字段（2 个同源报错）；已在共享 base fixture 补空数组，不改变产品逻辑。
- 为避免原生 callback/磁盘异常被误报为完整会议，新增持久化 `captureWarning` 并让最终状态保持 partial。首次 patch 的通用 `const stamp` 锚点把局部变量插进了 `createMeeting`；源码检查立即发现并移回 `finish`，尚未进入测试或交付。
- 增量纪要 schema 首次 patch 使用了不精确的状态变量上下文而未命中，文件未发生改变；改用真实相邻行拆分锚点后应用。
- 捕获告警首次回归出现 2 个完成会议被误标 partial：SQL 新增占位符后 `.run()` 参数仍按旧顺序，导致 `endedAt` 为空、时间戳写入 `captureWarning`。已按列顺序修正并新增 `captureWarning === ""` 与 `endedAt` 断言，防止同类序列化错位。
- 首次追加原生 WAV 单测时按 rustfmt 预期格式锚定尾部，但该文件尚未全量格式化，patch 未命中；按真实尾行重试，无代码丢失。

---

# 主题家族与明暗模式进度（2026-08-12）

- 用户已确认按独立明暗模式 + 独立主题家族实现，Midnight 亮色命名为 Daybreak。
- 已完成现状调查、API 类型拆分、App 状态与持久化、四组主题 token、设置页双控件、侧栏毛玻璃恢复、测试与文档同步。
- 已完成完整回归：Desktop 204/204 Node、Rust 55/55、`svelte-check`、Desktop/root production build、`git diff --check`。
- 已完成冷启动：重启本地 Desktop Vite 后首次打开设置，主题家族仍为 Catppuccin；明暗模式切换为“跟随系统”后解析为 light；侧栏保持 `blur(18px) saturate(1.6)`。

## 2026-08-12 — 消息菜单与文件面板主题同步

- Assistant 底部共享菜单增加向上展开 placement，避免向输入栏方向覆盖。
- File / Artifact Inspector 的 chrome 颜色改为继承 shared semantic tokens，主题家族和解析后的明暗状态统一生效。
- 已完成红测→修复→绿测：Desktop UI 201/201；浏览器冷路径重新打开设置页正常，静态检查确认 Inspector 不再有独立明暗/家族色板。
# Chat Transcript Optimization 进度日志

## 2026-08-10 — 调查启动

- 已完整读取用户附带的 190 行原始分析。
- 已完整读取 `planning-with-files` 与 `frontend-design` 技能说明。
- 已确认根目录 planning 文件属于前一项 Durable Execution 工作；采用顶部独立章节保留历史，不覆盖。
- 当前正在逐条核对代码、设计规范、PRD 与历史前科；尚未修改产品源码。
- 已开始时序切片：共享 conversation/desktop contract 增加 step、usage 和活动时长/退出码/行数/token 字段；服务端投影已从 raw assistant parts 构建有序 step。
- 首轮定向测试 14/15；唯一失败是既有活动深相等期望未包含本次新增字段，属于预期 fixture 更新，下一步补固定时钟和交错顺序断言。

## 2026-08-10 — Chat 优化实现与验证

- 已完成有序 persisted/live step、活动元数据、turn 汇总、共享 DecisionCard、结构化审批和多 pending 队列。
- 已完成 Plan 切片：Provider 前工具收窄、`exitPlan` artifact、可编辑 PlanCard、会话权限菜单、同 Session 无污染续跑与 checklist 状态投影。
- 已完成 Mermaid/KaTeX、HTML/SVG 沙箱预览、宽表 SpreadsheetTable、CommonMark breaks、回答大纲、80 条分页、长活动预览和展开态保存。
- 验证通过：Desktop 190/190 + Rust 55/55；`svelte-check` 0/0；Desktop build 与 root production build。服务端受影响定向测试 68/68；Plan artifact 与持久化 round-trip 新守卫已加入。
- 唯一非绿项是既有 SessionStore FTS 测试的 Node SQLite `unable to use function bm25 in the requested context`，单测独跑仍复现。
- 冷启动走查完成：全新临时 `DATA_DIR` 启动服务，首次打开 Desktop Web preview，关闭 onboarding，确认聊天首屏、模型菜单中的 Plan 权限模式、暗色主题与 390px 窄宽度；代理在服务停止时返回失败、同目录重启后重新连通。测试服务和浏览器标签均已关闭。
- 最终回归再次通过：root production build、Desktop `svelte-check` 0/0、Desktop 190/190、Rust 55/55、Plan save → fresh store → load round-trip 1/1；`git diff --check` 通过后交付。

---

# Automatic Durable Execution 进度日志

## 2026-08-09

- 已读取 `planning-with-files` 与 `agent-runtime-debug-review` 技能规范。
- 已创建 `task_plan.md`、`findings.md`、`progress.md`。
- 下一步：读取 PRD、设计文档、历史修复记录和当前运行时实现。
- 已读 PRD 第 1–240 行：核心为专用 SQLite、线性状态机、确定性/惰性自动启用、side-effect 意图/回执、跨 attempt 新 Context、任务级预算与共享投影。
- 现有工作区已有用户改动；规划文件与当前 `HEAD` 一致，未覆盖其他用户内容。
- 已完整读取 PRD 第 1–478 行：明确四个桌面表面、共享动作契约、切片顺序、验收测试矩阵及 out-of-scope；产品负责人确认 seam 的原文由本轮用户消息覆盖。
- 已完成第一轮运行时文件地图：现有 Runner/RunnerPool、事件 lease/scheduler、automation Session archive/过滤、Runtime Task API 与桌面任务 store 可复用；尚未开始代码实现。
- 已建立 Durable Execution 领域词汇并更新 `CONTEXT.md`。
- 已新增 `durable/types.ts` 与 `durable/store.ts`，并在 `storagePaths` 注册专用 `durable-execution.sqlite`；覆盖初始计划/步骤/验收、版本 CAS、attempt lease、孤儿恢复、步骤状态、副作用 intent/receipt、evidence ref、decision 和短句柄。
- 下一步：先跑类型检查，补临时 SQLite 回归测试；若发现 schema/事务问题先修 store，再接 coordinator/API。
- 首轮全仓类型检查暴露 7 个新增 store 类型错误，已修复；新增路径局部过滤检查通过，`git diff --check` 通过。
## 2026-08-09 — Durable Execution 第一纵向切片验证

- `DurableExecutionCoordinator` 已补充临时 SQLite 回归：owner 隔离、projection、CAS 控制动作和 actionId 重放均通过。
- Desktop 181 项 UI/响应式守卫、`svelte-check` 以及 Durable store/coordinator 10 项测试均通过。
- UI 守卫原先只允许 Artifact inspector；已改为验证 Artifact 与 Durable 共用一个 inspector host，未增加第二右侧栏或第二 resizer。
- 下一步进入运行时主链路：创建/继续执行只生成 watched event JSON，由 owner internal event 触发共享 Durable coordinator；Channel 只承担既有消息适配。

## 2026-08-09 — Durable Execution 主链路收尾

- 已把工具 side-effect 分类接到共享 `ToolRuntime`：`pure` 不进入边界，`idempotent/queryable/non_idempotent` 在 handler 前写 intent、handler 后写 receipt；未声明工具按保守的非幂等处理，幂等键对完整输入做稳定序列化哈希。
- 已补任务级累计 token/attempt/lifetime 配额、未终结任务上限、创建顺序 queue position 和 verifier 不消耗 Agent attempt 配额；Runner 的 Run usage 现在累加所有模型响应，而不是只保留最后一条。
- 已补 `continue_work` 的用户动作：不会把已完成 plan 循环改回运行中，而是创建新的 user-authored plan version，并保留用户已确认的 criterion。
- 已接入 Desktop 现有 `FeedbackCoordinator`：等待用户/审批、恢复、partial、完成、失败和取消状态只通过共享反馈链触发终态通知，避免把进度刷成 transcript 消息。
- 验证：Durable/tool 定向回归 37/37；Runner + Durable 回归 49/49。已通过 `svelte-check` 0 错误/0 警告与生产构建；桌面 guard 仍有一个既有 dirty-worktree 的 `RunActivity` 断言不匹配。Durable one-shot continuation 已接入共享 catch-up window，超窗会进入 `recovery_required`；该行记录的是前一阶段边界，后续 lazy promotion 已在当前切片补齐。

## 2026-08-09 — Lazy promotion handoff 完成

- 普通 Run 首次遇到非纯工具时，按 `idempotent` / `queryable` / `non_idempotent` 等级最多各做一次结构化模型 preflight；低等级判断为 ordinary 后不重复收费，首次进入更高等级会重新判断。
- preflight 选择升级时，coordinator 在专用 SQLite 内吸收已执行前缀、证据摘要和副作用回执，只把当前动作作为下一步排队；ToolRuntime 用 pi agent loop 的 `terminate` 标记在 handler 前停止当前普通 Run。
- 验证：Durable/tool 42/42、Runner 34/34、Runner + Durable store/runtime 49/49；改动范围 TypeScript 过滤检查仅剩既有 `runnerHelpers.test.ts` 两处错误。

## 2026-08-10 — Durable recovery/evidence/approval/channel slice

- Queryable 恢复现在按 step 幂等键查找外部状态探针；没有探针、探针抛错或返回 `unknown` 时进入 `waiting_for_user` recovery decision，新增回归证明不会调用来源 Runner。
- 证据读取闭环已完成：按 execution 授权的 evidence ref 解引用精确 source chat、Project、attempt Session 和 run id；run-detail 输出最多 24KB、标记 `untrusted`，目标消失时 fail soft。Durable attempt 只在自身工具集加载 `durableEvidence`，普通对话不增加该工具。
- 审批闭环已完成：请求和 repeat count 持久化，选择 once/session/persistent 后由共享 Durable runtime 消费；隐藏 attempt 的审批通过来源渠道 internal notice 暴露，QQ/微信复用来源消息，`/durable` 短句柄服务按 owner/Bot/channel/chat 鉴权。
- 验证：Durable 全套（activation/channel/coordinator/events/evidence/preflight/runtime/store）与 `durableEvidence` 工具共 37/37；新增 `durableEvidence` 工具与 queryable 无探针守卫均通过；受影响路径 TypeScript 过滤检查仅剩既有 `runnerHelpers.test.ts` 两处错误。该阶段先完成了临时 DATA_DIR 的直接重启冒烟；下方记录随后补齐了真实 Chat API + 同库重启 seam，完整冷启动/跨渠道矩阵仍是未完成的 release gate。

## 2026-08-10 — Chat API 重启 seam 与虚拟 Web profile 路由

- 修复真实 `/api/chat` Durable 激活的 manager 路由：Web API 允许使用未物化 profile，但 Durable attempt 必须落到实际 Web channel manager；现在按请求 profile、`default`、配置顺序首个 manager 解析，并在没有 manager 时保留清洗后的 id 让运行时显式失败。
- 新增 `src/lib/server/web/identity.test.ts` 3 项路由守卫。使用临时 `DATA_DIR`、本地 OpenAI-compatible provider 和真实 `scripts/start-server.mjs` 做了完整 HTTP 冒烟：`profileId=personal` 入队后收到 1 次 provider 请求，停止服务并用同一目录重启，Desktop API 读回 `status=recovery_required`、`attemptStatuses=[interrupted]`，持久化 `botId=default`。
- 这次 live seam 不等同于完整发布验收：真实 Telegram/飞书/QQ/微信 transport、重启后的来源通知和恢复后的 Agent 证据读取仍需冷启动/跨渠道矩阵；外部 provider 也尚未纳入该临时 fixture。

## 2026-08-12 — D2 与中文表格预览收尾

- 已完成 D2 服务端渲染：`d2` fenced block 在 Chat、Project Chat、Markdown artifact 中统一进入 Desktop D2 API；服务端默认使用 Kroki，可通过 `MOLIBOT_D2_RENDER_ENDPOINT` 指向自托管 renderer，客户端提供预览/源码/复制/放大和源码降级。
- 已修复 Markdown 表格中文乱码：聊天表格弹窗改用 UTF-8 `CsvTable`，不再把文本 CSV 送入二进制 XLSX parser；同步增加 CJK 回归测试。
- 左侧导航吸顶标题的背景改为 Session hover 使用的 `var(--fill)`，仍保留 blur 及低性能/无障碍 opaque fallback。
- 验证：D2/CSV/parser 21/21，D2 route + Desktop API 91/91，Desktop structural guard 203/203，`svelte-check` 0 错误/0 警告，Desktop/root build 通过，Kroki 真实 HTTP 探测返回 SVG，`git diff --check` 通过。

## 2026-08-10 — Runner helper 类型守卫修复

- 根因属于测试 fixture 的推断漂移：未标注类型的 settings 对象把 custom provider 的 `tags` 与 `supportedRoles` 推断成 `string[]`，而 `RuntimeSettings` 要求 canonical capability literal unions；这是类型守卫失去上下文，不是运行时路由逻辑错误。
- 修复只给两个 fixture 加上 `typeof defaultRuntimeSettings` 上下文类型，没有在生产代码中加入 cast、兼容层或 fallback。
- 机器守卫：`runnerHelpers.test.ts` 5/5；全仓 `tsc` 输出不再命中该文件；Desktop structural guard 183/183；`git diff --check` 通过。全仓 TypeScript 仍有其它既有诊断，未把它们误报为本次已清零。
# Note 自动刷新与 Markdown（2026-08-13）

- 已读取 `diagnosing-bugs`、`planning-with-files`、`frontend-design` 规范，以及 `CONTEXT.md`、`DESIGN.md`、`CHANGELOG.md`、`CLAUDE.md` 相关记录。
- 已确认刷新根因：前台 focus 刷新仍在，但缺少持续 revision 检测；同屏 Agent 写入不会触发 focus。
- 已确认 Markdown 根因：卡片正文使用 `textContent`。
- 已新增针对 Note UI 的自动刷新结构回归与 Markdown 安全输出回归，下一步先运行并确认当前实现为红。
- 首次红测试在测试收集阶段发现 `pathToFileURL` 导入模块错误；已修正为 `node:url`，未改生产代码。
- 修正测试后，两个回归均按预期为红：Note 无 revision polling；内置包无 `ui/markdown.js`。实现后 Markdown 安全渲染已转绿，轮询守卫仅因测试未包含并发去重条件仍红，已同步真实约束。
- 核心 Note/Bootstrap/HTTP 回归通过；Mini App design baseline 抓到一个裸 `0.9em` 字号，已换成共享字体 token。
- 自动刷新、刷新竞态和 Markdown 安全渲染等聚焦测试 37/37 通过。
- 已同步 DESIGN、PRD、features、CHANGELOG 与中英文 README，内置 Note 版本升级到 `1.4.0`。
- 真实冷路径通过：全新临时数据目录启动服务、安装 Note、首次打开面板后通过宿主 Agent action 写入 Markdown；不切换面板约 2 秒即出现 heading/list/table DOM。临时服务、代理和数据目录已清理。
- Root production build 与 Desktop `svelte-check`（0/0）通过，`git diff --check` 通过。
- 全量 Mini App 测试 147/148；唯一失败是既有 `toolAdapter.test.ts` 深相等 fixture 未包含当前运行时已有的 `effect` / `thirdPartyHint` 字段，与 Note 改动无关，聚焦相关测试仍为 37/37。

---
