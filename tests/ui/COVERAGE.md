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
| 冷启动 | 已实现 | 浏览器 | `chat.spec.ts`（cold start） |
| 消息输入（Enter / Shift+Enter / 空消息 / 组合输入） | 已实现 | 浏览器 + 单元 | `chat.spec.ts`（input / composition） |
| 消息回复（首发、连发、流式更新、输入恢复、请求总数） | 已实现 | 浏览器 | `chat.spec.ts`（cold start、streams progressively） |
| 请求失败（超时 / 错误码 / 断开 / 429） | 部分交付 | 浏览器 + 单元 | `chat.spec.ts`（429 / 500 / dropped connection）。**超时**待验证：桌面 SSE 空闲看门狗窗口为 90s，未纳入日常 UI 用例；未单独立项覆盖 |
| 允许审批 | 已实现 | 浏览器 | `approval.spec.ts`（allow） |
| 拒绝审批 | 已实现 | 浏览器 | `approval.spec.ts`（reject） |
| 审批竞争（重复点击、提交中切换会话） | 待验证 | 集成 | 由 `src/lib/server/app/desktopHostBash.test.ts` 等覆盖；UI 竞争未单独用例 |
| Stop（生成中、工具中、待审批时） | 部分交付 | 浏览器 + 集成 | `chat.spec.ts`（生成中 Stop）。工具中 / 待审批时 Stop 待补 |
| 会话切换（草稿、状态不串、后台回复归属） | 已实现 | 浏览器 | `chat.spec.ts`（draft switching、background reply） |
| 队列与插话（入队、顺序、取消、清空、插话） | 部分交付 | 浏览器 + 集成 | `chat.spec.ts`（queue + remove）。插话（steer）与顺序执行 UI 用例待补 |
| 排队时审批 | 待实现 | 集成 + 浏览器 | 未开始 |
| 设置保存（保存、离开返回、重启回读、不覆盖其他配置） | 部分交付 | 集成 + 浏览器 | `shared-rules.spec.ts`（保存 + 重启回读）+ `settings/*Roundtrip.test.ts`（整对象 round-trip）。设置页字段级浏览器用例待补 |
| 服务恢复（停启后无永久加载、无重复） | 部分交付 | 浏览器 + 原生 | `chat.spec.ts`（service restart）。原生中断恢复未验证 |
| 刷新接续（生成中刷新接上回复） | 待实现 | 浏览器 | 未开始 |
| 原生传输（流式、二进制下载、握手、崩溃恢复） | 环境受限 | 原生 | 需要带 Tauri 驱动的测试构建 |

## P1 待覆盖

会话管理；忙碌保护；Agent；Room；计划；导航；模型与 Provider；Prompt/Skill；附件；文件与产物；记忆；提醒与周期任务；MCP；MCP OAuth；插件与子代理；Mini App；图片与音频；Trace；中英、明暗、窄宽度与固定保存栏。随相关 feature 逐项补齐，只为已实现的界面入口写行为测试。

## 环境限制

- 原生 App 测试（`pnpm test:app`）尚未建设：需要默认关闭的 Cargo 编译开关、独立应用标识、隔离的 HOME/DATA_DIR。`verify:feature` 在涉及原生路径时输出「原生：未验证」。
- OpenAI 兼容以外的模型协议未覆盖。
- macOS 系统界面自动化（文件选择器、通知、权限弹窗、录音设备）不建设。
