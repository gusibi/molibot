# Session 运行态重新订阅（刷新接续）

日期：2026-10-15

文档状态：阶段 1（分离运行 + 恢复结果）已交付。阶段 2（刷新后继续收到实时增量）未开始。本文是 [Feature 开发验证自动化](feature-verification-spec.md) 中 P0「刷新接续」的前置与实施记录。

## Problem Statement

桌面聊天里，生成过程中刷新页面会丢失正在进行中的回复。这不是界面 bug，而是运行生命周期与一次 HTTP 请求绑定的结果：

- SSE 事件只写进 `/api/stream` 这次请求的响应流，服务端不保留可供再次读取的事件序列。
- `/api/stream` 把 `request.signal` 作为 `clientSignal` 传给 Runner，客户端断开时 Runner 主动 `abortRun({ source: "client_disconnect" })`。
- 恢复逻辑 `chatSessionStore.reconnect()` 出于「避免会话被幽灵运行永久占用」的考虑，会主动中止其余孤儿运行。

结果：刷新得到「Interrupted」和部分回复；用户要么等运行结束再刷新，要么丢失正在生成的内容。

## Solution

阶段 1 把运行生命周期从发起它的那次 HTTP 请求里拆出来，并让客户端「接上运行的结局」：

1. **请求不再决定运行生死**：`/api/stream` 不再向 Runner 传 `clientSignal`。客户端断开只是结束这一次订阅，运行在服务端继续，直到自然完成、被显式 Stop、或命中运行上限。
2. **运行到完成**：服务端拥有运行并在结束时把回复持久化到会话（沿用现有终态持久化）。用户已确认采用「运行到完成」而不是「无订阅者即中止」（2026-10-15）。
3. **客户端恢复**：页面加载或重连轮询发现某会话有运行中的运行、且本 Desktop 没有在驱动它时，`reconnect()` 把该运行收编进对应会话的 controller，由 `recoverRunningTurn()` 显示「Resuming…」状态并轮询 `/api/desktop/session-runs`，直到该运行结束，然后 reload transcript。期间用户仍可 Stop（`/api/stream/stop` 服务端中止）。
4. **不重发**：恢复过程从不重发用户消息，因此不会重复执行；回复只由服务端持久化一次。运行结束后刷新即可看到完整回复。

这样「生成中刷新页面」既不丢失（服务端会保存），也不重复（客户端不重发）。刷新后是否继续看到逐字实时增量，属于阶段 2。

## Implementation Decisions

- **取消语义只改一处**：`clientSignal` 断开即中止的行为从普通 Web 回合里移除；用户 Stop、预算中止、provider abort 等其它中止来源不变。Runner 仍保留 `clientSignal`，供其它调用方使用。
- **恢复放在共享上层**：`chatSessionStore.reconnect()` 与 `ConversationController.recoverRunningTurn()` 负责恢复；Channel 层不参与。
- **不新增业务分支**：恢复使用既有的 `session-runs` 与 `reload`，不引入「跳过权限」「伪造完成」之类路径。
- **无订阅者策略**：采用运行到完成（决策 A）。代价是用户关掉 App 后一次已发起的回合仍会跑完并消耗额度；真正的长任务仍由 durable execution 承载。
- **顺带修复**：生成中刷新会取消页面在途请求，`refreshAgentSessions` 的取消会冒泡成未处理的 Promise 拒绝；已在来源处捕获（非关键刷新失败保留上一次列表）。

### 阶段

1. **阶段 1（已交付）**：服务端移除断开即中止；客户端恢复结果；浏览器用例覆盖「生成中刷新后接上回复，无丢失无重复」。
2. **阶段 2（未开始）**：服务端运行事件日志（按 `sessionId + runId`，带单调 `sequence`）与 `GET /api/stream/attach?conversationId=&runId=&after=` 订阅接口，沿用 Room events 的 `after` / `Last-Event-ID` 游标约定；客户端在刷新后订阅并回放实时增量，再接终态。终端持久化边界不变。

## Testing Decisions

- 浏览器用例：发送一个被模型「暂停」的回合（`hold`），收到 Stop 后刷新页面，断言 Desktop 进入恢复态（Stop 仍可见），释放模型后回复恰好出现一次，且模型只收到一次该回合（无重复发送）。
- 刷新会取消页面在途请求，WebKit 会把这类取消报成页面错误。这类错误在用例里按类型显式列入白名单（`expected-page-error` annotation），不是全局静默；未处理的 Promise 拒绝在来源处修复，不靠白名单掩盖。

## Out of Scope

- 阶段 2 的实时增量回放（需要运行事件日志与订阅接口）。
- 跨设备、跨进程的会话接管（需要事件日志持久化）。
- 原生 WebView 窗口关闭/重开后的接续（先由浏览器路径验证）。
- durable execution 的事件回放（已有独立机制）。

## Further Notes

- 现状事实与阻塞记录见 [tests/ui/COVERAGE.md](../../tests/ui/COVERAGE.md)「刷新接续」行与 prd.md 的 `Feature 开发验证自动化` 小节。
- Room events（`src/routes/api/desktop/rooms/events/+server.ts`）已经用 `after` 游标做重连，是阶段 2 接口形状的参照。
