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
