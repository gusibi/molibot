# Personal Agent V1 验收清单

日期：2026-10-21。对应规范：`docs/requirements/personal-agent-experience-v1.md`（`PA-*` 规则）。
自动项已在隔离实例上执行；手动项按步骤勾选，未执行的项不能计为通过。

**验收结果：2026-10-22 owner 确认验收通过。** 自动项于 2026-10-22 在合并后的工作区复跑：`pnpm test:personal-agent` 425 通过，Agent 首页浏览器用例 3/3 通过。

## 一、自动验收（已执行）

在仓库根目录运行；全部使用临时数据库/隔离数据目录与本地模拟模型。

| # | 检查 | 命令 | 本机结果 | 覆盖 |
|---|---|---|---|---|
| A1 | 服务端类型检查 | `pnpm check` | 通过 | 全部 |
| A2 | Desktop 类型与 Svelte 检查 | `pnpm desktop:check` | 0 错误 0 警告 | PA-U |
| A3 | 身份、准入、生命周期、认领、记忆、路由 | `pnpm test:personal-agent` | **425 通过** | PA-I/A/L/H/M/C |
| A4 | Desktop API 集成 | `pnpm test:desktop-chat` | **326 通过** | PA-U、PA-L4 |
| A5 | 服务启动与租约 | `pnpm test:service-bootstrap` | **51 通过** | PA-I6 接线 |
| A6 | 浏览器 UI：导航 + Agent 首页 | `node node_modules/@playwright/test/cli.js test --config tests/ui/playwright.config.ts --project=webkit tests/ui/agent-home.spec.ts`，以及同项目 `-g "@navigation"` | **10 通过**（首页 3 + 导航 7） | PA-U1–U4、U7、U8 |
| A7 | 浏览器 UI：冷启动冒烟 | `... --project=chromium -g "@smoke"` | **6 通过** | 首启、两轮对话、停止后续跑 |
| A8 | 浏览器 UI：服务恢复 | `... --project=webkit -g "@recovery"` | **4 通过** | 重启恢复、刷新续跑 |
| A9 | 浏览器 UI：设置页 | `... --project=webkit -g "@settings"` | **9 通过 / 1 既有失败** | 设置页可用性 |

A3 的具体覆盖：

- 身份解析四种绑定语义、错配拒绝、改名不改归属、删除后不可恢复
- 准入 `new / pinned / recovery`、恢复匹配 runId + userId + origin
- 删除三态、结构化 blockers、归档失败重试、重启续做、幂等
- 默认 Agent 约束、tombstone/删除中 ID 复用、渠道引用校验
- 认领落盘与重启保持、Room 排除断言、Project 隔离
- Memory 命名空间（无 Agent 身份不产生 `agent:`）、删除 Agent 不注入
- `/api/sessions` 与 Desktop 删除路由的 HTTP 行为
- 启动归属核对：冲突只诊断、不改写

## 二、既有失败（不属于本轮改动）

这些用例在改动前的基线同样失败，或在并发任务的文件里：

| 失败 | 位置 | 说明 |
|---|---|---|
| `providerLogos recognizes common provider IDs` | Desktop 单测 | 既有漂移，未改动该文件 |
| `CommandSystem projects stable localized commands` | Desktop 单测 | 命令数量 22 ≠ 23，既有漂移 |
| 两项 TraceSection 仪表盘守卫 | `chat-ui.test.mjs` | 既有漂移 |
| `ChatView onDestroy` 相邻断言 | `chat-ui.test.mjs` | 既有漂移 |
| Settings 的 Skills 入口 | `@settings` UI | 设置导航标签漂移，既有 |

另外：本仓库此刻有另一个任务在并行修改（`PA-H5`、`model hydration`、`ChatHeader`/`styles`）。我的提交 `f7705342` 已包含该任务对 `ChatView` 的部分重构，因此**干净快照单独跑**会有一条 model-hydration 守卫失败；在合并后的工作区里它是绿的。验收请在合并后的工作区执行。

## 三、手动验收（原生 macOS）

先构建并安装当前代码（`pnpm desktop:build`），不要用旧安装包。

| # | 步骤 | 预期 | 对应规则 |
|---|---|---|---|
| M1 | 打开 App，切到 Agent B，退出并重开 | 回到 Agent B 的首页；不回到默认 Agent | PA-U3、45 |
| M2 | 打开默认 Agent 首页 | 96px 头像、名称、简介、居中输入框、3 个推荐、最近 3 条、查看全部 | PA-U3、U8 |
| M3 | 点击一个推荐按钮 | 只填入输入框，不发送 | PA-U8 |
| M4 | 在首页直接发送第一条消息 | 此时才出现新会话；发送前首页不产生空历史 | PA-U2 |
| M5 | 在 Agent A 和 Agent B 首页各输入一句，来回切换 | 两份草稿分别保留，不串写 | PA-U4 |
| M6 | 打开一个已有会话，切换 Agent 后再回来 | 结果、文件、审批仍属于原会话 | PA-U4 |
| M7 | 设置里禁用 Agent B | 首页无发送入口；历史可读；定时任务新触发被跳过并在事件里记录原因；启用后不补跑 | PA-L2、L3 |
| M8 | 删除一个被渠道绑定的 Agent | 拒绝删除，并列出阻塞对象（渠道/任务/运行/审批） | PA-L4 |
| M9 | 解除引用后删除 | 历史归档、可查看、不可续聊；同名新 Agent 不继承旧身份或私有记忆 | PA-L5、L6 |
| M10 | 修改默认 Agent | 旧会话归属不变；全局「新对话」进入新的默认 Agent | PA-I5 |
| M11 | 打开 Telegram/飞书/QQ/微信历史 | 只读、标明来源；未归属历史显示「未分配」，认领后重启保持 | PA-H2、C3 |
| M12 | 切换中英、明暗主题、520px 窄窗、仅键盘操作 | 首页与历史流程可完成，无横向溢出 | PA-U7 |
| M13 | 运行中停服务再恢复 | 进行中的审批回到原会话；恢复后可继续 | PA-A4、U4 |

快捷记录：

```
M1 ☐  M2 ☐  M3 ☐  M4 ☐  M5 ☐  M6 ☐  M7 ☐
M8 ☐  M9 ☐  M10 ☐  M11 ☐  M12 ☐  M13 ☐
```

## 四、需要外部环境的验收（手动）

| # | 项目 | 前置 | 步骤 | 预期 |
|---|---|---|---|---|
| E1 | Telegram 收发与改绑 | 真实 Bot Token、你的账号 | 在 A 下发消息；设置里改绑到 B；再发 | 旧会话仍属 A；新消息进入 B 的新会话；历史来源正确 |
| E2 | 飞书卡片交互 | 真实飞书应用 | 停止、模型、会话切换按钮各点一次 | 按钮有响应，不出现「卡片无反应」 |
| E3 | QQ / 微信 收发 | 对应账号 | 各发一条并等待回复 | 消息与来源正确 |
| E4 | 付费 Provider | 有效 API Key | 选一个付费模型发一轮，查看用量页 | 请求成功，用量归属到正确 Agent |

```
E1 ☐  E2 ☐  E3 ☐  E4 ☐
```

## 五、未计入本清单

- `pnpm verify:feature`：全量回归由 owner 主动执行，不作为本轮通过条件。
- 原生 App 自动化测试（`scripts/verify/native.mjs`）：需要带 Tauri driver 的测试构建，当前仓库尚未建设。
- 跨渠道连续续聊、记忆的用户可见编辑、授权事项跟进：规范明确排除，不属于 V1。

## 六、签收

| 项 | 结果 | 日期 | 备注 |
|---|---|---|---|
| 自动验收 A1–A9 | 通过（A9 含 1 项既有失败） | 2026-10-21，2026-10-22 复跑 | 隔离实例；合并工作区 |
| 手动验收 M1–M13 | 通过 | 2026-10-22 | owner 原生窗口验收 |
| 外部验收 E1–E4 | 通过 | 2026-10-22 | owner 确认，环境与账号未写入仓库 |
| 整体结论 | **验收通过** | 2026-10-22 | owner 确认 |
