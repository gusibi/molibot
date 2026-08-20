# 图片按需识别与多引擎模块（2026-08-20）

## Goal

把图片从“入站时一次性转文字”改为可重复、按需读取的文件能力：当前实际主模型支持视觉时原生读取，不支持时由 `read` 调用独立图片识别模块；第一期支持多个 API 引擎与顺序故障切换，CLI 只保留 Adapter 接入位，Channel 只负责可靠保存和规范化附件。

## Phases

- [completed] 1. 固化领域契约与红测试
  - 验证：多 API 引擎顺序、失败记录、原生/识别分流、同图多次读取、无入站预识别、Channel 附件统一形状均有失败回归。
- [completed] 2. 实现图片识别深模块与动态设置
  - 验证：一个小 Interface 隐藏预处理、模型 Adapter、故障切换、usage/warnings；`imageRecognition` 使用细粒度动态 key 并通过临时数据库 round-trip。
- [completed] 3. 合并到 read 与 Runner，删除旧路径
  - 验证：活动模型支持视觉时 `read` 返回图片；否则返回识别证据；删除公开 `imageAnalyze` 和入站 fallback，不保留兼容层；PDF OCR 复用内部模块。
- [completed] 4. 收口 Feishu/Telegram 等 Channel 附件路径
  - 验证：所有 Channel 只接收/保存/恢复统一图片附件，队列恢复后仍可原生或按需读取，Channel 中不存在识别调用。
- [completed] 5. 图片设置页双 Tab 与独立保存
  - 验证：图片生成/图片识别使用 shadcn Tabs；多 API 引擎可增删、排序、测试和独立保存；中英、明暗、移动宽度、固定底栏成立。
- [completed] 6. 文档、对抗审查与完整验证
  - 验证：定向/全量测试、`svelte-check`、build、冷启动与服务恢复通过；同步 DESIGN、features、prd、CHANGELOG、README。

## Success criteria

- 收到图片时，文本主模型场景在调用 `read` 前不会发生视觉 API 请求。
- 当前实际模型（含 fallback candidate）已验证支持视觉时使用原始图片，不走识别引擎。
- 同一路径可用不同 prompt 在同一轮调用多次；每次结果和引擎 attempts 可追踪。
- 第一 API 引擎失败时按配置顺序切到下一个；CLI 第一阶段不可启用但无需改外部 Interface 即可在第二期加入。
- Channel 新增/变化不需要实现图片识别、重试或 Provider 路由。

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| 根目录 planning 文件包含历史任务 | 1 | 在顶部新增独立章节，保留全部历史内容 |
| 首次定向测试命令缺少 `--import tsx`，`$lib` alias 无法解析 | 1 | 改用项目既有 Node + register-loader + tsx 组合，不重复错误命令 |
| 根项目没有 `check` script / `svelte-check` 可执行文件 | 1 | 用生产 build 覆盖 Svelte 编译；Desktop 子项目单独执行 `desktop:check`，0 错误 / 0 警告 |
| 首次 production build 发现图片页 Tabs 关闭顺序错误 | 1 | 修正节点关闭顺序后连续两次生产 build 通过 |
| Desktop 全量 Node 测试 211/212 | 1 | 唯一失败是任务前基线的 Stop 静态断言仍要求直接 `await stopDesktopChat`，而未改动的生产代码已使用 `Promise.race`；不越权修改无关代码 |

## Verification

- Settings / routing / recognition / read / document / runner focused suites: 170/170 passed.
- Channel attachment focused suite: included above and passed for Feishu, Telegram, QQ, Weixin, Web and queue rebuild paths.
- Desktop `svelte-check`: 0 errors / 0 warnings; root production build passed twice.
- Desktop full Node suite: 211/212; sole pre-existing unrelated structural assertion recorded above.
- Real cold path: first open, Tab switching, engine add/order controls, 390px width, dark mode, service interruption and same-data restart all passed with no console errors.
- `git diff --check`: passed.

## Desktop follow-up（2026-08-20）

- [completed] 7. 将图片识别设置完整接入 Desktop App
  - 验证：Desktop 使用独立安全投影、精确 HTTP scope、专用 store 和“图片生成 / 图片识别”双 Tab；多引擎增删排序、保存、未保存配置上传测试、中英/明暗/窄宽成立。
- [completed] 8. Desktop 回归与真实冷路径
  - 验证：API/结构/响应式守卫、`svelte-check`、build、冷启动、Tab 切换、服务中断恢复通过；产品文档同步 Desktop 已交付边界。

### Desktop follow-up verification

- Desktop client API: 88/88; image-recognition projection/runtime: 6/6.
- Desktop `svelte-check`: 0 errors / 0 warnings; Root and Desktop production builds passed.
- UI/HTTP/reactivity structural suite: 212/213; sole failure remains the unrelated pre-existing Stop assertion documented above.
- Isolated cold path: Generation/Recognition tabs, two-engine add and reorder, fixed save bar, persisted reload, dark appearance, service timeout, explicit retry and same-data recovery passed.

---

# 会议纪要产品验收返工：录音状态机与历史库（2026-08-14）

## Goal

把用户已判定不可用的 Meeting Notes 重新做成最小但完整的产品：活动会议只有一个清晰工作区，原生支持录音 → 暂停 → 继续 → 结束，结束后的会议进入可搜索、可回看的历史库，不再把采集恢复、活动状态、详情和历史混在一个平铺页面里。

## Phases

- [completed] 1. 建立失败验收与红测试
  - 验证：宿主契约缺少 pause/resume、服务端缺少 paused 状态、页面缺少独立 Live/History 导航时，回归测试必须明确失败。
- [completed] 2. 根修原生录音状态机
  - 验证：同一 capture 可 recording → paused → recording → stopped；暂停边界会冲刷已录样本，暂停期间时长和音频不增长，关闭面板后状态仍由宿主持有。
- [completed] 3. 对齐会议领域状态与历史投影
  - 验证：paused 状态可持久化和重启恢复；活动会议不会在历史区重复出现；处理中的会议与终态会议均能从历史库找到。
- [completed] 4. 重做 Meeting Notes 页面信息架构
  - 验证：单列 Live/History 两个明确表面；Live 提供大计时器、暂停/继续和结束；History 提供日期分组、搜索、详情返回路径和完整空状态；中英、明暗与窄宽度成立。
- [completed] 5. 完整验证、冷路径与交付
  - 验证：聚焦测试、Rust、Desktop、build、真实冷启动与服务恢复通过；内置 App bump 版本；features/prd/CHANGELOG/README 按真实边界同步。

## Success criteria

- 页面上不会同时出现两份“正在录音”的同一会议。
- 用户可以多次暂停和继续，暂停不是结束的别名，结束后不能再继续。
- 历史记录是一个可进入、可搜索、可回看的产品表面，不是首页下方的数据库行列表。
- 页面刷新、关闭再打开 Mini App 后，Live/History 与宿主真实状态一致。
- AI 识别或总结失败不影响音频与历史记录保留，并给出明确可重试状态。

## Acceptance correction

2026-08-14 的真实用户验收推翻了上一版“完成”结论：上一版虽然打通了分片上传和后台采集，但没有实现计划中声称的 pause/resume，也没有形成真实历史库；基础设施通过不能替代产品可用性验收。下方 2026-08-13 计划保留为审计记录，不再代表当前完成状态。

## Verification

- Meeting/host/design focused: 18/18.
- Built-in install/manifest/bootstrap/meeting: 40/40.
- Desktop full suite: passed, including 205 structural guards and 56 Rust tests.
- Desktop `svelte-check`: 0 errors / 0 warnings.
- Root and Desktop production builds: passed.
- Full Mini App suite: 157/158; sole failure is the pre-existing `toolAdapter.test.ts` fixture missing current `effect` / `thirdPartyHint`, already recorded before this slice.
- Fresh temporary data directory installed Meeting Notes `2.1.0`; temporary service stopped and data moved to Trash.
- Visual browser cold path remains manual: the available in-app browser blocked loopback and no external Chrome controller was connected.

---

# 会议纪要生产化 V1（2026-08-13）

## Goal

把内置 Meeting Notes 从 iframe 内一次性录音草稿升级为可恢复的线下会议产品：V1 只实现麦克风来源，但采集协议、存储和时间线从第一天支持多音轨；实时转写、增量纪要和最终收敛均建立在统一时间轴上。

## Phases

- [complete] 1. 固化领域模型、状态机与失败不变量
  - 验证：临时 SQLite 覆盖多轨音频块、单调时间范围、幂等入队、缺口检查、停止 barrier 与重启恢复。
- [complete] 2. 建立共享后台麦克风采集会话
  - 验证：Mini App UI 只发 start/pause/resume/stop 意图；关闭面板后宿主采集会话仍存活；音频持续落盘而非整段驻留内存。
- [complete] 3. 接入实时转写时间线与会中工作台
  - 验证：临时/最终话轮、时间戳、说话人标签、识别延迟和断线补录可见；下游不依赖具体采集来源。
- [complete] 4. 增量纪要、最终收敛与产品打磨
  - 验证：长会议不发送全文单次 prompt；决定/行动项带来源；中英、明暗、移动宽度、冷启动与服务恢复通过。
- [complete] 5. 文档与版本交付
  - 验证：内置 App 版本升级；features/prd/CHANGELOG/README 与能力矩阵按真实交付边界同步；对抗式审查和完整测试通过。

## Success criteria

- 录音生命周期不由 iframe 生命周期决定。
- 音频块从写入开始就带 `trackId/sourceKind/startMs/endMs`，V1 只产生 microphone 轨。
- 一小时会议没有单文件上传或单次全文总结；任何缺失区间都可见且可补处理。
- 重启后恢复 queued/processing 工作；完成、失败、取消和重试保持幂等。
- 后续增加 system 音频只新增采集适配器，不改转写、话轮、纪要领域模型。

## Key decisions

| Decision | Reason |
|---|---|
| Meeting Notes 保留 Mini App 产品边界，采集与流式 AI 放共享宿主层 | UI/领域仍可独立迭代，同时凭据、原生权限和后台生命周期不泄漏到 iframe |
| V1 只实现 microphone adapter，但 schema/API 原生支持多轨 | 已明确的后续系统音频需求不应触发数据模型重写 |
| 不沿用旧 Python/Host Bash 草案 | 项目已有宿主 AI routing 与原生音频能力；绕开它们会形成第二套凭据和运行时 |

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| 根目录 planning 文件已被多个历史任务使用 | 1 | 在顶部新增本任务独立章节，保留既有内容和用户改动 |
| 首次插入 planning 章节因标题空格上下文不匹配 | 1 | 使用文件真实首行精确重试；未改动产品源码 |

---

# Note 自动刷新与 Markdown 渲染（2026-08-13）

## Goal

修复 Agent 写入 Note 后已打开面板不更新的问题，并让 Note 卡片安全渲染常用 Markdown，同时保留编辑时的原始 Markdown。

## Phases

- [x] 查历史记录、设计规范和现有 Note/Todo 刷新契约
- [x] 建立自动刷新与 Markdown 安全渲染回归
- [x] 实现 revision 轮询、Markdown 渲染与内置 Note 版本升级
- [x] 更新产品文档并完成定向测试、类型检查、构建和冷路径验证

## Verification

- Note/Bootstrap/HTTP/UI focused suite: 37/37 passed.
- Full Mini App suite: 147/148 passed; the sole failure is the pre-existing `toolAdapter.test.ts` expectation missing current `effect` and `thirdPartyHint` fields, outside this change.
- Desktop `svelte-check`: 0 errors / 0 warnings.
- Root production build: passed.
- Cold path: fresh temporary service, first Note open, Agent-path write, and in-place Markdown refresh passed; temporary data and processes removed.
- `git diff --check`: passed.

## Success criteria

- 已打开的 Note 面板能在 Agent 写入后自动出现新笔记，无需切换页面或重新聚焦。
- 后台/隐藏面板不持续拉取笔记正文，只检查前台 revision 并在变化时刷新。
- 标题、列表、强调、引用、链接、代码和表格可读；原始 HTML、危险协议与远程图片不能执行或加载。
- 已安装的内置 Note 能通过版本升级收到修复，owner 数据保持不变。

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| 新回归测试从 `node:path` 导入 `pathToFileURL`，测试在收集阶段失败 | 1 | 改从 `node:url` 导入，再运行红测试 |
| Mini App 设计守卫拒绝 Markdown inline code 的裸 `0.9em` 字号 | 1 | 改用共享 `--md-body-sm-size` / `--md-body-sm-lh` 字体阶梯 token |

---

# D2 服务端渲染与中文表格修复（2026-08-12）

## Goal

完成 D2 服务端渲染接入，修复 AI 回复表格预览中的中文 UTF-8 乱码，并把左侧导航吸顶背景统一到 Session hover surface。

## Phases

- [x] 调查表格预览、Markdown fenced block、服务端 renderer 与导航 sticky surface
- [x] 实现 D2 服务端代理、Chat/Project Chat/Artifact 共享渲染入口和安全源码降级
- [x] 将聊天表格切换到 UTF-8 CSV viewer，并锁定 CJK 回归
- [x] 补设计/功能/PRD/README/ChangeLog 记录
- [x] 运行定向测试、UI guard、类型检查、生产构建和 Kroki 实际探测

## Verification

- D2/CSV/parser: 21/21
- D2 route + Desktop API: 91/91
- Desktop UI structural guard: 203/203
- `svelte-check`: 0 errors / 0 warnings
- Desktop and root production builds: passed
- Kroki `/d2/svg`: HTTP 200, `image/svg+xml`
- `git diff --check`: passed

---

# 主题家族与明暗模式拆分（2026-08-12）

## Goal

将 Desktop 的主题家族与明暗模式拆成两个独立、可持久化的设置：明暗模式为 Light / Dark / System；主题家族为 macOS 精简、Rosé Pine、Catppuccin、Midnight。Rosé Pine 使用 Dawn/Moon，Catppuccin 使用 Latte/Macchiato，Midnight 补充 Daybreak 亮色配套。

## Phases

- [x] 1. 调查现有主题状态、设置页、token 和第三方预览入口
- [x] 2. 设计并实现独立的 appearance/theme-family 状态与持久化
- [x] 3. 添加四组主题 token、明暗映射和主题预览 UI
- [x] 4. 更新测试、文档和回归守卫
- [x] 5. 运行完整验证、冷启动检查并复核 diff

## Success criteria

- 两个设置可独立切换，刷新/重启后均保留。
- Light / Dark / System 只控制亮暗，不覆盖主题家族。
- macOS、Rosé Pine、Catppuccin、Midnight 四个家族均有亮/暗配套。
- Chat、Settings、Artifact、Markdown、Agent City、第三方预览和原生窗口不出现主题串色或系统主题泄漏。
- Desktop UI/API、类型检查、构建和冷启动验证通过。

## Verification

- Desktop UI/API and native suite: 204/204 Node tests, 55/55 Rust tests.
- `svelte-check`, Desktop production build, root production build, and `git diff --check` pass.
- Cold path after restarting the local Desktop Vite server: Appearance opens with independent controls; Catppuccin persists; System resolves to light in the test environment; sidebar computes `blur(18px) saturate(1.6)`.

## Follow-up: message menu and Inspector theme sync

- [x] Reproduce the downward assistant overflow menu and the Inspector's isolated palette.
- [x] Add red-capable UI guards, fix shared menu placement, and derive Inspector chrome from shared tokens.
- [x] Re-run focused UI tests and complete the Desktop type/build/cold-path verification.
# Chat Transcript Optimization 执行计划（2026-08-10）

## 目标

逐条验证用户对 chat 渲染链路的完成度分析，并按依赖顺序完成所有仍存在的差距：时间序列数据模型、Plan/Decision 原语、结构化审批与队列、Markdown 能力、活动元数据与长内容交互、展开态持久化、长记录性能、turn 汇总与回答大纲；最后完成真实桌面冷路径和文档同步。

## 当前阶段

- [completed] 1. 现状、历史与设计约束核对
  - 验证：逐条建立“已完成 / 未完成 / 分析已过时”的代码证据表；读取 `DESIGN.md`、相关 PRD、`CHANGELOG.md`/归档与 `CLAUDE.md` 前科。
- [completed] 2. 数据契约与纵向时序模型
  - 验证：真实 turn 能表达并按顺序渲染 text/thinking/tool/plan/decision step，旧的固定三段投影被直接移除，无兼容层。
- [completed] 3. Decision/Plan/Approval 原语
  - 验证：共享快捷键/焦点仲裁；Plan 可编辑、采纳/拒绝并随执行更新；审批支持结构化 diff/路径和多个 pending 项。
- [completed] 4. 内容与活动呈现补齐
  - 验证：Mermaid/KaTeX 使用共享 Markdown 管线；安全 HTML/SVG 有 artifact 出路；宽表可进入 Spreadsheet；活动含元数据、无嵌套滚动、展开态跨 live/final 保留。
- [completed] 5. 长记录导航、性能与汇总
  - 验证：长 transcript 有分页或虚拟化；turn 级耗时/工具/文件/token 汇总；回答 heading 可导航。
- [completed] 6. 回归、冷启动与文档交付
  - 验证：单测、UI guard、`svelte-check`、build、真实冷路径（重启→首次打开→切换 Session/页面→服务中断恢复）通过；同步 `features.md`、`prd.md`、`CHANGELOG.md` 与 README 导航。

## 关键决策

| 决策 | 原因 |
|---|---|
| 先核对再改，按模型→共享原语→呈现→性能推进 | 防止在旧 `activities[]` 形状上继续堆 UI 状态，减少返工 |
| 现有 planning 文件内容保留在下方 | 之前 Durable Execution 任务仍有未完成验收记录，不能覆盖用户工作 |

## 错误记录

| 错误 | 尝试 | 解决 |
|---|---:|---|
| 当前根目录 planning 文件已被前一任务占用 | 1 | 在文件顶部新增本任务独立章节，保留旧任务完整记录 |
| activity 既有深相等测试未包含新增元数据 | 1 | 改为固定时钟并更新期望，同时新增交错 step 回归 |
| Svelte 不允许 `{@const}` 直接放在普通 div 下 | 1 | 把活动 preview 派生值提升为 `{#each}` 的直接子级 |
| KaTeX CSS 被纯 Node 测试直接导入 | 1 | 将样式入口移到 Desktop `main.ts`，保持渲染模块可在 Node 中测试 |
| 新 Plan CSS 使用了项目不存在的 token | 1 | 改用 DESIGN 已定义的语义 token，并由 CSS token guard 验证 |
| SessionStore FTS 回归报 `bm25` context error | 2 | 单独重跑仍复现；判定为既有 Node SQLite FTS 环境问题，未改动搜索实现 |
| 浏览器预览默认不连接本地服务 | 1 | 使用项目已有 `VITE_MOLIBOT_PREVIEW` + `MOLIBOT_DESKTOP_PREVIEW_TARGET` 接缝完成真实临时数据目录走查 |

---

# Automatic Durable Execution 执行计划

## 目标

按照 `docs/requirements/automatic-durable-execution-prd.md` 实现可持久化、可恢复、可观测的自动 durable execution，并保持跨渠道能力在共享上层，最后完成针对性测试与全量验证。

## 阶段

- [completed] 1. 需求与现状勘察
  - 验证：读完 PRD、相关设计/历史记录，定位现有事件、调度、队列、lease、runner 与持久化入口。
- [completed] 2. 设计边界与最小纵向切片
  - 验证：形成数据模型、状态机、恢复/幂等不变量和受影响文件清单。
  - 当前切片：确定性创建 + 专用 SQLite + shared coordinator actions + Desktop list/detail/inspector entry。
- [completed] 3. 实现持久化执行主链路
  - 验证：专用 SQLite、版本 CAS/lease、步骤/证据/decision、副作用 intent/receipt、共享 verifier、任务级预算与续跑事件的临时库回归通过；工具边界与 Runner 累计 usage 已接入。
  - 结果：Durable Execution 通过 watched event JSON 与共享 runtime internal-event 接缝运行，Channel 仍只负责消息/平台适配。
- [in_progress] 4. 接入运行时恢复、调度与用户可见状态
  - 已完成：启动 reconcile、fresh automation attempt、队列位置/创建顺序、暂停/恢复/取消/继续决策、Desktop 卡片/单一 inspector/侧栏/通知反馈。
- 已完成：真实模型 lazy promotion、按副作用等级限次 preflight、普通 Run 前缀吸收和当前副作用 handler 前的安全交接；离线 catch-up 的事件窗口与 `recovery_required` 状态 seam 也已完成。
- 已完成：queryable 外部探针的 fail-closed 恢复、证据读取器与 Durable attempt 只读入口、approval/source-channel 投影、共享 `/durable` 短句柄命令和 QQ/微信来源消息通知。
- 已完成：真实 `/api/chat` + 本地 OpenAI-compatible provider + 同一 `DATA_DIR` 服务重启 acceptance；虚拟 `personal` profile 已验证路由到 `default` Web manager，并恢复为 `recovery_required`。
- 待完成：完整冷启动/跨渠道验收矩阵，以及外部 provider 下的等价 live 验收。
- 验证：当前 Durable/runtime/evidence/approval/channel focused suite 通过；Desktop `svelte-check` 与生产构建通过，Desktop UI guard 183/183 通过。全仓 TypeScript 仍有与本切片无关的既有诊断，受影响的 `runnerHelpers.test.ts` 已清零。
- [completed] 5. 文档与版本交付同步
  - 已同步 `docs/requirements/automatic-durable-execution-prd.md`、`features.md`、`prd.md`、`CHANGELOG.md`、`readme.md`、`readme.zh-CN.md`，并明确已交付与待验收边界。

## 成功标准

1. PRD 中的 Must/验收条件都有对应实现或明确的阻塞说明。
2. 自动执行只通过 watched event JSON 与运行时事件系统落地，不绕过共享运行时写 OS scheduler。
3. 执行、恢复、重试、停止、完成、失败、取消具有幂等行为，不产生重复 terminal 队列行或并发自动运行。
4. 运行时控制信息、用户通知、排障记录彼此分离，不污染模型持久化上下文。
5. 持久化测试只使用临时数据库或可注入 store，不触碰真实用户数据。

## 错误记录

| 错误 | 尝试 | 解决 |
|---|---:|---|
| 首次读取技能文件使用了错误路径 | 1 | 改用当前技能目录中的实际路径，未影响代码执行 |
| 发现记录追加补丁上下文不匹配 | 1 | 先读取文件末尾确认现状，再用精确上下文重试；未改动源码 |
| 追加 Events/scheduler 记录时重复使用已存在的上下文 | 1 | 读取发现记录尾部确认记录其实已存在，停止重复写入 |
| 首轮全仓 `tsc --noEmit` 失败 | 1 | 识别为既存依赖/类型错误加 7 处新增 store 类型错误；仅修新增错误，保留既存失败项并用局部测试验证 |
| store 测试从入口导入错误类失败 | 1 | 从 `store.ts` 重新导出领域错误类，保留类型定义单一来源 |
| store round-trip 测试假定同一时间戳的 criterion 排序 | 1 | 按 criterion 描述定位记录，避免依赖 SQLite 对同时间行的隐含顺序 |
| Desktop 守卫测试仍断言单一 Artifact inspector 可见性 | 1 | 将断言更新为同一 inspector host 下的 Artifact/Durable 两种模式，保留单 host/单 resizer 约束 |
| `runnerHelpers.test.ts` 的 custom provider fixture 被推断为 `string[]` | 1 | 给 fixture 加上 `typeof defaultRuntimeSettings` 上下文类型，让 `tags` / `supportedRoles` 继续受 canonical capability union 约束；未改生产逻辑 |
