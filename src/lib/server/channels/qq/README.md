# QQ 渠道接入

QQ 渠道基于 `package/qqbot`（2.1，[`@tencent-connect/qqbot-nodejs`](https://www.npmjs.com/package/@tencent-connect/qqbot-nodejs) 薄适配层）实现，协议层（WS 网关、token、富媒体上传、流式、交互）由腾讯官方 SDK 维护。

## 目录结构

```
src/lib/server/channels/qq/
├── index.ts           # 渠道插件注册（settings.channels.qq 实例 → ResolvedQQBotAccount → QQManager）
├── runtime.ts         # QQManager：事件消费、命令、队列、outbox、C2C 流式、输入中、审批卡下发
├── voice.ts           # 语音消息发送：原生 wav/mp3/silk 直传，其余 ffmpeg→PCM→silk-wasm 编码，失败降级文件
├── approvalButtons.ts # host-bash 审批按钮卡：键盘构建 + 交互回调 → 审批指令（对齐 Telegram 模式）
└── inboundText.ts     # 入站文本：优先用户文字，其次 QQ 平台语音转写（asr_refer_text）
```

## 消费面（经 `#qqbot/*` 深层导入）

| SDK 模块 | 使用 |
|---|---|
| `#qqbot/src/gateway.js` | `startGateway`（onEvent + onInteraction）+ `GatewayContext` |
| `#qqbot/src/outbound.js` | `sendText` / `sendMedia` / `sendTextWithKeyboard` / `sendTyping` / `openC2cStream` / `acknowledgeInteraction` |
| `#qqbot/src/api.js` | `initApiConfig` / `clearTokenCache` / `MediaFileType` |
| `#qqbot/src/types.js` | `ResolvedQQBotAccount` |

## 消息能力

- **文本**：被动回复（限流 1 小时 4 次，超限自动降级）；C2C 主动推送自动走唤醒消息（`is_wakeup`，30 天窗口）。
- **C2C 流式回复**：私聊回合内容以打字机流式刷新（`stream_messages`），失败自动降级为一次性合并发送；群聊维持合并发送。
- **输入中**：私聊处理期间显示"输入中"并周期续期。
- **媒体**：图片/视频/文件按类型路由；音频走语音消息（转换链见 `voice.ts`），失败降级文件。
- **审批按钮**：host-bash 审批发送为内联按钮卡（批准一次/本会话/持久 + 拒绝），点击回调经 `QqApprovalInteractions` 解析 token 后走 `SharedRuntimeCommandService`，5 秒内 ACK；键盘发送失败降级为纯文本指引。
- **语音入站**：QQ 平台转写文本（`asr_refer_text`）直接作为消息文本。

## 配置

molibot 设置里的 `channels.qq.instances`（appId / clientSecret / allowedChatIds），不使用 openclaw 的 yaml 多账户格式。

## 参考

- 适配层说明与升级历史：`package/qqbot/README.md`、`package/qqbot/CHANGELOG.md`
- [QQ Bot 官方文档](https://bot.q.qq.com/wiki/)
