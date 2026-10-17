# UI / 原生验证覆盖清单

状态仅使用「已实现 / 部分交付 / 待验证 / 未开始」四种（与工作/生活助理能力矩阵一致）。
每一行的「负责层」说明主要断言落在哪一层；UI 层验证界面表现。

运行方式：

- 全部浏览器 UI 测试（WebKit）：`pnpm test:ui`
- 单个项目：`node node_modules/@playwright/test/cli.js test --config tests/ui/playwright.config.ts --project=webkit|chromium`
- 本次改动需要的验证：`pnpm verify:feature`
- 原生 App 核心测试：`pnpm test:app`（尚未建设，见下）

## 测试接缝

- 只设一个主接缝：隔离的 Molibot 实例（`tests/ui/support/instance.ts`）。临时数据目录、临时 HOME、空闲端口、预设回复模型服务、外部渠道关闭；环境变量白名单；启动前守卫。独立应用标识属于原生构建，见「环境限制」。
- 模型是唯一的假依赖（`tests/ui/support/model-service.ts`），走真实的 OpenAI 兼容 Provider 适配器。
- 运行时细节由既有 node:test 集成测试负责。

## 基础设施自测

| 项目 | 状态 | 测试 |
|---|---|---|
| 隔离实例守卫（临时目录 / 回环模型 / 不落到真实数据目录 / 环境白名单） | 已实现 | `tests/ui/support/guard.test.ts` |
| 预设回复模型服务（分段工具调用拼接、多工具调用、暂停释放、未匹配记录并失败） | 已实现 | `tests/ui/support/model-service.test.ts` |
| 自动选择映射（路径 → 标签，原生路径必选原生） | 已实现 | `scripts/verify/selection.test.mjs` |

## P0 场景

| 场景 | 状态 | 负责层 | 用例 |
|---|---|---|---|
| 强制迁移（错误跳过、报告、备份、窄窗与重启） | 已实现 | 集成 + 浏览器 | `storage-migration.spec.ts` + `agentStorageMigration.test.ts` |
| 冷启动 | 已实现 | 浏览器 | `chat.spec.ts`（cold start） |
| 消息输入（Enter / Shift+Enter / 空消息 / 组合输入） | 已实现 | 浏览器 + 单元 | `chat.spec.ts`（input / composition） |
| 消息回复（首发、连发、流式更新、输入恢复、请求总数） | 已实现 | 浏览器 | `chat.spec.ts`（cold start、streams progressively） |
| 请求失败（超时 / 错误码 / 断开 / 429） | 已实现 | 浏览器 + 单元 | `chat.spec.ts`（429 / 500 / dropped connection、idle timeout 呈现与再次发送）；`api.test.ts`（SSE 空闲看门狗拒绝） |
| 允许审批 | 已实现 | 浏览器 | `approval.spec.ts`（allow） |
| 拒绝审批 | 已实现 | 浏览器 | `approval.spec.ts`（reject） |
| 审批竞争（重复点击、提交中切换会话） | 已实现 | 集成 + 浏览器 | `approval.spec.ts`（重复点击恰好一次、待审批时切换不串、提交中切换后恰好一次）+ `conversationController.test.ts`（延迟窗口内重复提交只发一次）+ `desktopApprovals.test.ts`（延迟窗口重复决策恰好执行一次、已中止后决策不执行、跨会话决策不串） |
| Stop（生成中、工具中、待审批时） | 已实现 | 浏览器 | `chat.spec.ts`（生成中 Stop、工具运行中 Stop、待审批时 Stop，之后均可继续发送） |
| 会话切换（草稿、审批、状态不串、后台回复归属） | 已实现 | 浏览器 + 存储回读 | `chat.spec.ts`（draft switching、background reply、storage read-back：后台回复落到所属会话存储）+ `approval.spec.ts`（审批不串） |
| 队列与插话（入队、顺序、取消、清空、插话） | 已实现 | 集成 + 浏览器 | `chat.spec.ts`（queue+remove、顺序执行、清空不执行、插话投递）+ `conversationController.test.ts`（出队顺序与恰好一次、并发出队不重复发送） |
| 排队时审批 | 已实现 | 浏览器 | `chat.spec.ts`（审批与排队按顺序推进） |
| 设置保存（保存、离开返回、重启回读、不覆盖其他配置） | 已实现 | 集成 + 浏览器 | `agent-settings.spec.ts`（保存留在当前分类与文件、连续保存、失败重试、返回与重启回读、中英明暗窄窗）+ `settings.spec.ts`（默认执行模式字段级 round-trip + 不覆盖 Agents）+ `shared-rules.spec.ts`（共享规则保存与重启）+ `settings/*Roundtrip.test.ts`（整对象 round-trip） |
| 服务恢复（停启后无永久加载、无重复） | 部分交付 | 浏览器 + 原生 | `chat.spec.ts`（service restart）。原生中断恢复未验证 |
| 刷新接续（生成中刷新接上回复） | 已实现 | 浏览器 | `chat.spec.ts`（生成中刷新后恢复运行、恰好一次、无重复发送）。阶段 1：服务端不再断开即中止、客户端恢复结果；刷新后继续接收逐字实时增量属阶段 2，见 [session-run-reattach-spec](../../docs/requirements/session-run-reattach-spec.md) |
| 原生传输（流式、二进制下载、握手、崩溃恢复） | 环境受限 | 原生 | 需要带 Tauri 驱动的测试构建 |

## P1 待覆盖

会话管理；忙碌保护；Agent；Room；计划；导航；模型与 Provider；Prompt/Skill；附件；文件与产物；记忆；提醒与周期任务；MCP；MCP OAuth；插件与子代理；Mini App；图片与音频；Trace；中英、明暗、窄宽度与固定保存栏。随相关 feature 逐项补齐，只为已实现的界面入口写行为测试。

## 环境限制

- 刷新接续（P0）当前不可实现为测试，需先做产品决策：`reconnect()` 按设计中止孤儿运行，刷新会中止进行中的回复。详见上表。
- 原生 App 测试（`pnpm test:app`）尚未建设：需要默认关闭的 Cargo 编译开关、独立应用标识、隔离的 HOME/DATA_DIR。`verify:feature` 在涉及原生路径时输出「原生：未验证」。
- OpenAI 兼容以外的模型协议未覆盖。
- macOS 系统界面自动化（文件选择器、通知、权限弹窗、录音设备）不建设。

正文 Markdown 本地图片：`markdown-images.spec.ts` 在真实共享 transcript 组件中覆盖生成图路径到附件、异步 Blob 更新、图片解码、360px/480px 预览上限、原比例、窄宽度、点击放大和读取失败；`markdownImages.test.ts` 覆盖加载去重与同名歧义。使用临时实例和本地 PNG，组件用例模拟图片 HTTP 响应，不调用真实图片 Provider。

桌面四个功能工作区：`workspaces.spec.ts`（`@workspace`）覆盖独立导航、自动任务四类分段筛选与一次性任务空结果、切回恢复列表、任务选中与宽窗缩放固定 320px 列宽、未选中插画、真实暂停及重启回读、标题栏搜索展开/自动聚焦/Esc 清空收起还焦点与无匹配、技能启停与服务端结果、计划进度与窄窗返回、小程序管理与返回按钮原位切换、AI 图标悬浮说明与设置往返、中英明暗和窄窗，以及 macOS 明暗、Terminal、Windows 98、Brutalism、Raft、导入主题和中英即时切换。数据来自临时实例的真实 API 和临时技能文件。

工作区标题栏回归同时断言创建、管理为纯图标、刷新直接触发真实 API，技能范围通过分段按钮切换并验证空结果和恢复。

工作区顶部信息覆盖自动任务/计划说明可见，小程序管理不在标题栏且数量位于管理按钮左侧，并验证管理页往返。

计划修订回归（`workspaces.spec.ts` @plans）覆盖编辑草稿本地保留、切页返回后续编辑、外部修订触发版本冲突提示且草稿不丢、以最新版本重览后保存、真实读回任务与步骤、中英明暗窄窗与服务重启后草稿仍在、丢弃草稿不影响已保存版本。

`plans.spec.ts`（@plans @chat @approval）：31 步生成计划在计划工作区批准后由 Durable 执行器独立执行（不占用来源/承接 Session 的普通轮次），承接 Session 同时进行普通对话不受阻塞；步骤完成进入待验收，所有者确认后整计划归档。使用临时实例、本地模型夹具与真实计划 API。

`skills-management.spec.ts`：内置技能散列关联、删除后安装、修改覆盖前备份、旧版本更新、备份不作为技能扫描、管理仅在工作区及搜索配置仅在设置、搜索参数保存与整对象重启回读、窄窗与侧栏计划/技能顺序。

技能详情（`skills-management.spec.ts`）：点击卡片就地展开详情面板、显示「已被本地修改」与安装版本、关闭后回到卡片网格并继续内置更新；`apps/desktop/src/chat-ui.test.mjs` 结构检查锁定详情为页面内面板（含路径、YAML 元信息、目录区）而非弹窗，并锁定网格 ⇄ 列表使用测量式 FLIP。技能页全宽内容区由 `workspaces.spec.ts` 的切页与无横向溢出断言覆盖。

`workspaces.spec.ts` 顶部几何回归（`@workspace @smoke`）：计划各状态数量与真实 API 列表相符，搜索无匹配归零、清空恢复；计划、技能与自动任务在 1440/1120/860 宽度、中英、macOS 明暗及 Brutalism 深色下，说明区、筛选栏和分隔线位置一致（技能筛选栏并入共享规则，右侧不再显示统计文案），技能卡片网格静默态无边框、顶距 24px，防止卡片上边框在分割线下形成第二条缩进横线，窄窗无横向溢出。

`workspaces.spec.ts` 小程序限宽回归（`@workspace @smoke`）：小程序说明、工具栏及网格 x/right/width 完全一致，管理页继承同一列；覆盖 2240/1600/1440/1120/860、中英、macOS 明暗及 Brutalism 深色，并验证内容列不超过 1240px。
