# @molipibot/qqbot

QQ Bot 渠道适配层：把腾讯官方协议层 SDK [`@tencent-connect/qqbot-nodejs`](https://www.npmjs.com/package/@tencent-connect/qqbot-nodejs) 封装成 molibot 可嵌入的网关事件流 + 出站发送接口。

## 来源与升级历史

- **1.x（已废弃）**：fork 自官方插件 [`@tencent-connect/openclaw-qqbot`](https://github.com/tencent-connect/openclaw-qqbot) **1.7.1**，携带全套手写协议层（WebSocket 网关、token 管理、富媒体上传、斜杠指令、审批等 30+ 文件）。上游 1.7.1 之后不再维护这套代码。
- **2.0.0（当前）**：对齐官方插件 2.0.x 的架构方向——官方在 2.0 重构中删除了全部手写协议层，改由 `@tencent-connect/qqbot-nodejs`（腾讯官方 Node.js SDK，独立发版）承载协议。本包同步跟进：删除 fork 的协议层，改为基于该 SDK 的薄适配层（34 个源文件 → 5 个），协议层修复随 SDK 版本升级自动获得。

## 架构

```
package/qqbot/
├── index.ts            # 公共入口（re-export）
└── src/
    ├── types.ts        # ResolvedQQBotAccount / QQBotAccountConfig / ADAPTER_VERSION
    ├── gateway.ts      # startGateway：QQBot 实例生命周期 + 入站事件 → GatewayEvent 映射
    ├── outbound.ts     # sendText / sendMedia / sendProactiveMessage + 被动回复限流 + 目标解析
    ├── api.ts          # bot 实例注册表 + initApiConfig / clearTokenCache / getAccessToken 兼容入口
    └── outbound.test.ts
```

协议层职责（全部由 `@tencent-connect/qqbot-nodejs` 承担）：

- WebSocket 连接、心跳、RESUME 会话恢复（跨重启持久化在 `~/.molibot/qqbot/<accountId>/session.json`）
- token 获取 / 后台刷新 / 超时与错误上报
- 重连退避（可配置预算）、断线原因上报、启动 fail-fast
- 被动/主动消息分路、富媒体上传（含大文件分片、每日额度错误）

适配层保留的 molibot 约定：

- **事件流**：`startGateway({ account, abortSignal, onEvent, onInteraction, onReady, onError, log })`，`onEvent` 收到的 `GatewayEvent` 与 1.x 同形（`type`/`senderId`/`content`/`attachments`（含 `voice_wav_url`、`asr_refer_text`）/`groupOpenid`/…）；群非 @ 消息同样投递，@ 与白名单过滤由上层（`QQManager`）负责。`onInteraction` 收到按钮点击（`GatewayInteractionEvent`），QQ 要求 5 秒内 `acknowledgeInteraction` 回执。
- **发送签名**：`sendText({ to, text, accountId, replyToId, account })` / `sendMedia({ ..., mediaUrl, mimeType?, fileType? })` → `OutboundResult`（`error` / `errorCode` / `qqBizCode` / `refIdx`）。
- **目标地址**：`qqbot:c2c:xxx` / `c2c:xxx` / `group:xxx` / `channel:xxx` / 裸 openid（视为 c2c）。
- **被动回复限流**：同一消息 1 小时窗口内最多被动回复 4 次，超限/过期自动降级为主动消息。
- **媒体路由**：MIME 优先、扩展名回退（image/video/voice/file）；`fileType` 可显式覆盖；语音发送失败自动降级为文件发送；未知扩展名（如 agent 生成的 `.md`/`.pdf`）走文件通道。

### 富消息类型支持（2.1 起）

| 能力 | 入口 | 说明 |
|---|---|---|
| 主动/被动分路 | `resolveProactiveMode` + `sendText` | C2C 无 `replyToId` 的推送自动走 `is_wakeup` 唤醒消息（用户互动后 30 天窗口，额度远高于普通主动消息的每月 4 条）；群主动消息走普通主动接口 |
| 按钮键盘 | `sendTextWithKeyboard` | C2C/群内联按钮卡片；点击经 `onInteraction` 回调 + `acknowledgeInteraction` 回执 |
| 输入中提示 | `sendTyping` | 仅 C2C；按秒续期 |
| C2C 流式消息 | `openC2cStream` | 打字机效果（`stream_messages`）；须锚定 5 分钟内的入站消息，`update` 传全文（replace 语义），结束必须 `complete()` |
| 撤回 | `bot.recallMessage`（经 SDK 实例） | 由调用方按需使用 |

语音出站转换（ffmpeg → PCM → silk-wasm）在 `src/lib/server/channels/qq/voice.ts`（渠道层，可复用共享 `transcodeAudio` 与根依赖 `silk-wasm`），QQ 原生接受 WAV/MP3/SILK 直传。

## 消费方

`src/lib/server/channels/qq/`（经根 `package.json` 的 `#qqbot/*` subpath imports 深层导入）：

- `runtime.ts` → `startGateway` / `GatewayContext`（含 `onInteraction`）、`sendText` / `sendMedia` / `sendTextWithKeyboard` / `sendTyping` / `openC2cStream` / `acknowledgeInteraction`、`initApiConfig` / `clearTokenCache`、`ResolvedQQBotAccount`
- `voice.ts` → `sendQqVoice`（语音转换发送）、`isAudioSource` / `isNativeQqVoiceFormat`
- `approvalButtons.ts` → host-bash 审批按钮卡（键盘构建 + 交互回调 → 审批指令）
- `inboundText.ts` → 入站文本（含 QQ 平台语音转写 `asr_refer_text`）
- `index.ts` → 渠道插件注册（`toSDKAccount` 构造 `ResolvedQQBotAccount`）

## 与官方 openclaw-qqbot 2.0.x 的关系

本包不引入 openclaw 插件体系（PluginRuntime / middleware / dispatch 管道均为 openclaw 概念，molibot 有自己的运行时）。对齐的只有协议底座与官方 SDK 的使用方式（`QQBot` 实例、`bot.send*`、`FileKVStore` 会话持久化）。官方 2.0 的扫码登录（`qqbot-connector`）、Webhook 传输、按群细粒度配置属 openclaw 插件功能，molibot 侧暂不对应。

## 开发

```bash
cd package/qqbot
npm install
npm run build          # tsc → dist/
node --import tsx --test src/outbound.test.ts
```

修改本包后需在仓库根目录重新 `pnpm build` 才会进入服务端产物。

## 验证状态

- 单元测试（目标解析 / 媒体类型推断 / 主动路由决策 / 凭证守卫 / 错误文案）7/7，连续 5 次通过；渠道层（ASR 文本 / 语音格式 / 审批交互链路）12/12，连续 5 次通过。
- 真实 QQ 连接（登录、收发消息、语音/按钮/流式实际下发、断线重连）未在日常验证范围，需要专项验收时用真实凭证手工验证。
