# Handoff — Issue #67 Agent Handover

日期：2026-10-23  
仓库：`/Users/gusi/Github/molipibot`  
分支：`master`  
当前提交：`6c605ed1 feat(desktop): default agent home shows an agent handover`

## 会话目标与状态

本轮任务是实现 [Issue #67](https://github.com/gusibi/molibot/issues/67)（Agent Handover，`PA-HD1`–`PA-HD10`、`PA-HD12`、`PA-HD13`）。

状态：**已实现、已通过定向验证、已提交**。工作区里没有本轮留下的未提交改动。

需求、规则、决策与交付契约不要重抄，直接看：

- 规则：`docs/requirements/personal-agent-experience-v1.md`（`PA-HD-*`）
- 决策：`docs/adr/0006-agent-handover-is-a-projection.md`
- 交付契约：`docs/designs/agent-home/agent-handover-spec.md`
- 界面原型与选型记录：`docs/designs/personal-agent-home/`
- 本次提交：`git show 6c605ed1`

## 本轮实际落地

- 唯一读模型：`src/lib/server/app/desktopHandover.ts`
- 读/确认端点：
  - `src/routes/api/desktop/handover/+server.ts`
  - `src/routes/api/desktop/handover/ack/+server.ts`
- 数据窗口查询：
  - `SqliteTraceStore.listHandoverFactsSince()`（`src/lib/server/agent/hooks/traceStore.ts`）
  - `EventExecutionLeaseStore.listFinishedSince()`（`src/lib/server/agent/eventsLeaseStore.ts`）
  - `nextCronOccurrence()`（`src/lib/server/agent/events.ts`）
- 会话归属解析：`agentIdForSession()`（`src/lib/server/sessions/executionIdentity.ts`），读会话侧车，不读渠道绑定。
- 持久化：`desktopNavigation.lastAcknowledgedAt` / `previousHandover`（`src/lib/server/settings/schema.ts`、`sanitize.ts`）。sanitizer 会从当前设置继承这两个字段，普通导航保存不会擦掉。
- 界面：`apps/desktop/src/lib/chat/AgentHome.svelte`、`apps/desktop/src/ChatView.svelte`、`apps/desktop/src/styles.css`、`apps/desktop/src/lib/i18n.ts`
- 客户端 API：`apps/desktop/src/lib/api.ts`（`loadDesktopHandover` / `acknowledgeDesktopHandover`）
- 测试：
  - `src/lib/server/app/desktopHandover.test.ts`
  - `src/routes/api/desktop/handover/server.test.ts`
  - `src/lib/server/settings/handoverRoundtrip.test.ts`
  - `src/lib/server/agent/events.cron.test.ts`
  - `tests/ui/agent-home.spec.ts`
  - `tests/ui/support/seed-handover.ts`、`tests/ui/support/instance.ts`（`runSeedScript`）

文档已同步：`prd.md`、`features.md`、`CHANGELOG.md`、`DESIGN.md`、V1 规范、能力矩阵、ADR、交付 Spec、原型 README。

## 已验证（可复现）

在仓库根目录：

```bash
node --import ./scripts/register-loader.js --import tsx --test \
  src/lib/server/app/desktopHandover.test.ts \
  src/lib/server/settings/handoverRoundtrip.test.ts \
  src/lib/server/agent/events.cron.test.ts \
  src/routes/api/desktop/handover/server.test.ts
```

结果：18 项通过。

```bash
pnpm check
pnpm --dir apps/desktop run check
pnpm build
```

结果：均通过（svelte-check 0 错误 0 警告）。

浏览器 UI（隔离实例 + scripted model，WebKit）：

```bash
node node_modules/@playwright/test/cli.js test \
  --config tests/ui/playwright.config.ts --project=webkit tests/ui/agent-home.spec.ts
```

结果：10/10 通过，覆盖首次、活跃、快速离开再返回、就地拒绝审批、安静日、服务中断 stale、中英、明暗、窄窗、其他 Agent 不显示交接。

## 重要环境/流程注意事项

1. **UI 测试前必须 `pnpm build`**：`tests/ui/support/instance.ts` 启的是 `scripts/start-server.mjs`，它运行 `build/index.js`。新增服务端路由后不构建会得到 404，页面会显示“未更新 · 服务未连接”。
2. UI 实例是 **worker 级共享** 的；交接测试通过 `instance.stopService()` → 运行 `seed-handover.ts` → `instance.startService()` 写入场景，脚本会先清理 trace facts / leases / pending approvals 和导航窗口字段。不要跳过 stop/start，否则会和服务的 SQLite 句柄打架。
3. `seed-handover.ts` 的 `quiet` 场景会写一个 `0 8 * * *` 的默认 Agent 定时任务，用来断言“接下来”一行。
4. 交接测试场景：`active` / `quiet` / `first-run`。
5. 桌面守卫套件 `apps/desktop/src/chat-ui.test.mjs` 当前 321 项中 316 通过；4 项与本次改动无关的既有断言漂移仍存在：windowHeader（#102）、Trace 看板（#193、#196）、Agent 导航轮询顺序（#308）。其中 #308 已在 `HEAD` 版本确认同样失败。#299 已因本次去重改动更新并通过。

## 未完成/未验证

- 未执行全量 `pnpm verify:feature`（按仓库约定留给整体验收）。
- 未做原生 Tauri App 冷启动/窗口切换/服务中断走查。
- 未做真实外部渠道（Telegram/飞书/QQ/微信）与付费 Provider 验收。
- 这些都应如实标为未验证，不要当成通过。

## 已知边界（V1 有意为之）

- `PA-HD11`（Open Loop）未实现。
- 模型润色未实现；V1 只输出模板事实，默认关闭，也不提供开启入口。
- 普通对话运行没有步骤级进度，条目只显示任务摘要与时长。
- 散落产物没有统一索引。
- Broker 的非 Host Bash 审批会显示在交接里，但不能就地处理，只能打开源会话。

## 工作区里不属于本轮的改动（勿提交）

提交 `6c605ed1` 之后，工作区仍有另一条并行工作的未提交改动，**与本功能无关**：

- `src/lib/server/agent/prompts/*`（`profiles.ts`、`prompt.ts`、`promptInput.ts`、模板文件与删除项）
- `src/lib/server/time.ts`
- 未跟踪的 `findings.md`、`progress.md`、`task_plan.md`

下次提交前请只 `git add` 明确属于目标任务的文件；不要把这些并行改动一并提交。

## 建议的下一步

如果是继续做这个功能：

1. 先跑全量 `pnpm verify:feature`，再做原生 App 冷路径与真实渠道验收。
2. 若做产品打磨，优先处理：运行中条目的步骤级进度、产物索引、`PA-HD11`。
3. 若要做代码评审，重点看 `desktopHandover.ts` 的合并/去重/窗口语义，以及 `ChatView.svelte` 的离开首页确认时序。

## 建议调用的 Skills

- `code-review`：按本仓库规范评审本次提交，重点是文档同步、设置 round-trip、UI 冷路径。
- `diagnosing-bugs`：如果全量回归或原生走查出现失败。
- `tdd`：为后续修复或 `PA-HD11`/步骤进度补回归。
- `doc-lifecycle` / `doc-standards` / `prose-standard`：继续调整需求、设计或文档时。
- `web-design-guidelines`：如果继续打磨交接界面的可访问性与交互。
- `agent-runtime-debug-review`：只有在排查运行队列、审批挂起、恢复或状态不一致时使用。
