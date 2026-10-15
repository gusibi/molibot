# Session 运行态重新订阅（刷新接续）

日期：2026-10-15

文档状态：设计待用户确认关键决策后实施。当前普通 Web 对话的运行生命周期绑定在 `/api/stream` 的 HTTP 请求上，刷新即中止运行；本 spec 描述如何解耦运行生命周期并支持客户端重新订阅，作为 [Feature 开发验证自动化](feature-verification-spec.md) 中 P0「刷新接续」的前置。

## Problem Statement

桌面聊天里，生成过程中刷新页面会丢失正在进行中的回复。这不是界面 bug，而是运行生命周期与一次 HTTP 请求绑定的结果：

- SSE 事件只写进 `/api/stream` 这次请求的响应流，服务端不保留可供再次读取的事件序列。
- 客户端断开（刷新、关标签、网络中断）会触发 `clientSignal` 中止，Runner 主动 `abortRun({ source: "client_disconnect" })`，本轮运行就此终止。
- 恢复逻辑 `chatSessionStore.reconnect()` 出于「避免会话被幽灵运行永久占用」的考虑，会主动中止其余孤儿运行。

结果：刷新得到「Interrupted」和部分回复；用户要么等运行结束再刷新，要么丢失正在生成的内容。

## Solution（推荐方案：分离运行 + 事件日志 + 订阅接口）

把一次会话运行从发起它的那次 HTTP 请求里拆出来：

1. **运行生命周期与请求解耦**：`/api/stream` 仍负责「发起本轮」。请求结束后运行继续在服务端推进，直到自然完成、被显式 Stop、或命中运行上限。
2. **运行事件日志**：运行期间把面向客户端的事件（token、replace、thinking、activity、approval、plan、done/error）写入按 `sessionId + runId` 索引的内存事件日志，每条带单调递增 `sequence`。日志在运行结束后保留一个短窗口（供刚完成的订阅者读到 `done`），随后释放。终态落盘仍走现有会话持久化。
3. **订阅接口**：新增 `GET /api/stream/attach?conversationId=&runId=&after=<sequence>`，先回放 `sequence > after` 的历史事件，再持续推送新事件直到终态。沿用 Room events 的 `Last-Event-ID` / `after` 游标约定，配合服务端心跳与客户端现有 SSE 空闲看门狗。
4. **客户端重新订阅**：`chatSessionStore` 为每个会话记住最近一次订阅游标（`sessionStorage`，按 `会话 + runId` 键）。页面加载时若 `session-runs` 报告该会话有运行中运行，则订阅、回放、继续展示；收到 `done`/`error` 后照常 reload transcript。没有活动运行时保持现状。
5. **显式 Stop 语义不变**：`/api/stream/stop` 仍主动中止运行；`reconnect()` 不再中止仍可订阅的运行，仅在确实无运行可订阅时清理陈旧状态。
6. **无订阅者策略**：运行在没有任何订阅者时是否继续，是本 spec 需要用户拍板的决策（见下）。

## 需要用户确认的关键决策

运行与请求解耦后，会出现「没有任何客户端在看的运行」。三种取舍：

- **A. 运行到完成（推荐）**：一旦发起就跑到自然结束，结果落盘。与渠道消息一致（Telegram/飞书消息的用户并不保持连接）。代价：用户关掉 App 后仍可能继续消耗模型额度与工具副作用。
- **B. 无订阅者 N 秒后中止**：例如最后一个订阅者断开 30 秒仍无人接续就中止并持久化部分结果。代价：慢工具（默认上限可达一小时）会被误杀；需要额外的宽限窗口调参。
- **C. 维持现状**：刷新即中止，本 spec 不实施。

推荐 A：普通对话的一个回合通常较短，且「发起后完成」比「静默丢失」更符合用户预期；真正的长任务已由 durable execution 承载。若关注成本，可在设置里增加一个「后台继续运行」开关，但这属于本 spec 之外的增量。

## Implementation Decisions

- **事件日志放在运行时层**，不放 Channel：普通 Web、渠道与 Room 将来可共用同一份运行事件序列；会话级订阅是共享上层能力。
- **不改 Runner 的取消语义**：`abortRun` 及其来源（用户 Stop、预算、provider abort）保持不变，只把「客户端断开」从中止来源里移除，改为「结束本次订阅」。
- **游标幂等**：客户端按 `runId` 去重，同一游标重复订阅不重复渲染；`done` 之后不再接受该 `runId` 的新订阅（返回终态或 404）。
- **断开即释放订阅、不释放运行**：订阅连接关闭只移除订阅者，不触发 `abortRun`。
- **持久化边界不变**：只有运行的自然终态（或显式中止）写会话正文；回放不写盘。
- **安全**：订阅接口按会话身份解析（复用 `resolveWebConversationIdentity`），不能订阅非本人会话；事件内容与现有 SSE 一致。

### 阶段

1. **阶段 1（服务端）**：运行生命周期解耦 + 事件日志 + `attach` 接口 + 运行时集成测试（回放顺序、游标幂等、终态后订阅、断开不中止运行）。
2. **阶段 2（客户端）**：`sessionStorage` 游标、加载时重新订阅、Stop 与 reconnect 语义调整、无运行回退现状。
3. **阶段 3（验证）**：浏览器用例「生成中刷新接上回复，无丢失无重复」，连续 5 次通过，并证明能失败（去掉事件日志或回放后用例应失败）。

## Testing Decisions

- 服务端以「真实 handler + 临时数据库 + 可注入运行/事件存储」做集成测试；浏览器只验证界面表现。
- 关键字面：刷新后仍能看到同一 `runId` 的流式增量；完成后恰好一条 assistant 正文，无重复；显式 Stop 在刷新后仍能中止。

## Out of Scope

- 跨设备或跨进程的会话接管（需要事件日志持久化，另立 spec）。
- 原生 WebView 窗口关闭/重开后的接续（先由浏览器路径验证）。
- durable execution 的事件回放（已有独立机制）。

## Further Notes

- 现状事实与阻塞记录见 [tests/ui/COVERAGE.md](../../tests/ui/COVERAGE.md)「刷新接续」行与 prd.md 的 `Feature 开发验证自动化` 小节。
- Room events（`src/routes/api/desktop/rooms/events/+server.ts`）已经用 `after` 游标做重连，可作为接口形状的参照。
