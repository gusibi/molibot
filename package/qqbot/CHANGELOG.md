# Changelog

## 2.1.0 (2026-10-17)

接入 `@tencent-connect/qqbot-nodejs` 已提供但尚未使用的富消息类型（配合渠道层 `channels/qq` 的语音转换、审批按钮、C2C 流式、输入中提示）：

### 新增

- **主动/唤醒消息分路**（`resolveProactiveMode`）：C2C 无 `replyToId` 的推送（提醒、定时任务、被动窗口耗尽的降级回复）自动改走 `is_wakeup` 唤醒消息——用户互动后 30 天窗口内额度远高于普通主动消息的每月 4 条；群主动消息维持普通主动接口。
- **按钮键盘发送**（`sendTextWithKeyboard`）：C2C/群内联按钮卡片；`gateway` 新增 `onInteraction` 回调转发 `INTERACTION_CREATE`（适配为 `GatewayInteractionEvent`），并提供 `acknowledgeInteraction`（QQ 要求点击后 5 秒内回执）。
- **C2C 流式消息**（`openC2cStream`）：打字机效果会话（`stream_messages`），须锚定 5 分钟内入站消息；`update` 传全文（replace 语义）、结束必须 `complete()`。
- **输入中提示**（`sendTyping`）：仅 C2C，按秒续期。
- `sendMedia` 支持显式 `fileType` 覆盖 MIME/扩展名推断（供渠道层语音降级文件时强制 FILE 通道）。

### 行为变化

- `sendText` 主动路径（无 `replyToId`）对 C2C 目标改用 `sendWakeup`（`is_wakeup: true`）；被动回复与群消息行为不变。

## 2.0.0 (2026-10-17)

对齐官方 `@tencent-connect/openclaw-qqbot` 2.0.x 的升级方向：官方在 2.0 重构中删除了全部手写协议层，改由腾讯官方 SDK `@tencent-connect/qqbot-nodejs` 承载协议（WS 网关、token、富媒体上传）。本包同步重建为基于该 SDK 的薄适配层。

### 破坏性变更

- 删除 fork 自官方 1.7.1 的全套协议层与 openclaw 插件代码（`channel.ts`、`config.ts`、`runtime.ts`、`session-store.ts`、`message-queue.ts`、`slash-commands.ts`、`streaming.ts`、`stt.ts`、`approval-handler.ts`、`image-server.ts`、`utils/*` 等 29 个文件），不再随上游补丁演进。
- 依赖收敛：`ws` / `silk-wasm` / `mpg123-decoder` → `@tencent-connect/qqbot-nodejs ^1.0.5`（`ws` 由 SDK 自带）。
- 不再导出 openclaw 时代的入口（`qqbotPlugin`、`setQQBotRuntime`、`matchSlashCommand`、流式/审批/入群问候/斜杠指令等）——molibot 的 onEvent 模式本就不经过这些路径。

### 修复（随 qqbot-nodejs 1.0.1 → 1.0.5 获得）

- token 刷新竞态：重启 bot 不再取消新会话的 token 刷新；token 获取增加超时并上报 HTTP 状态与服务端响应。
- 网关稳定性：重连风暴修复（被拒连接不再重置重试计数）、握手静默丢弃、平台要求重连被误判为永久错误、启动失败 fail-fast 并给出明确原因、断线原因与是否自动恢复可观测。
- 媒体上传：COS 分片上传改走 https、`Uint8Array` 直接作为 fetch body、上传前文件大小预检、每日额度错误结构化（`UploadDailyLimitExceededError`）。

### 行为保持

- `startGateway` onEvent 模式的事件形状（含 `attachments.voice_wav_url` / `asr_refer_text`）、`abortSignal` 停止语义、`onReady`（READY/RESUMED 均触发）。
- `sendText` / `sendMedia` / `sendProactiveMessage` 签名与 `OutboundResult`（`error` / `errorCode` / `qqBizCode` / `refIdx`）。
- 目标地址解析（`qqbot:c2c:` / `c2c:` / `group:` / `channel:` / 裸 openid）。
- 频道（guild channel）文本消息与公网 URL 图片的 Markdown 内嵌发送；其他频道媒体明确报错。
- 被动回复限流（1 小时 4 次，超限降级主动消息）；语音发送失败降级为文件发送。

### 行为变化

- 会话持久化位置从 `~/.openclaw/qqbot/` 移到 `~/.molibot/qqbot/<accountId>/session.json`（SDK `FileKVStore` 格式）。
- 重连不再有硬编码次数上限（SDK 默认无限重试 + 指数退避；官方 1.0.5 行为）。
- `clearTokenCache()` 语义调整为丢弃已注册 bot 实例（token 生命周期归 SDK 管理）；`getAccessToken(appId, secret)` 走 SDK token 管理器。
- 群消息合并/淘汰队列（原 `message-queue.ts`）不再在 SDK 层做——molibot 的 `InboundTaskCoordinator` 本就承担按会话排队，重复排队移除。

## 1.7.1 (2026-05-01)

fork 自 `@tencent-connect/openclaw-qqbot` 1.7.1，加三处定制：`gateway.ts` 增加 `onEvent` 回调模式（绕开 openclaw runtime）、`channel.ts` 内联配置 helper、`slash-commands.ts` 默认 `upgradeMode` 改 `doc`。
