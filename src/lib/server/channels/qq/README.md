# QQ Bot SDK 集成指南

## 概述

QQ Bot 现在使用独立的 SDK (`package/qqbot`) 实现，提供增强功能：

- ✅ **后台 Token 自动刷新** - 无需担心 Token 过期
- ✅ **消息限流管理** - 自动处理被动/主动消息降级
- ✅ **富媒体支持** - 图片、语音、视频、文件发送
- ✅ **多媒体标签** - `<qqimg>`, `<qqvoice>`, `<qqvideo>`, `<qqfile>`
- ✅ **多账户支持** - 可配置多个 QQ Bot 账户
- ✅ **完善的重试机制** - 指数退避 + 单飞模式

## 目录结构

```
package/qqbot/                 # SDK 源码
├── src/
│   ├── api.ts                 # API 封装 + Token 管理
│   ├── channel.ts             # OpenClaw 插件实现
│   ├── config.ts              # 配置解析
│   ├── gateway.ts             # WebSocket 网关
│   ├── outbound.ts            # 消息发送
│   ├── types.ts               # 类型定义
│   └── utils/                 # 工具函数
├── dist/                      # 编译输出
├── package.json
└── tsconfig.json

src/lib/server/channels/qq/   # 适配层
├── index.ts                   # 重新导出（使用 SDK）
├── runtime.ts                 # QQManager 实现
└── api.ts                     # 向后兼容的 API 导出
```

## 配置格式

### 单账户配置（向后兼容）

```yaml
channels:
  qq:
    enabled: true
    credentials:
      appId: "YOUR_APP_ID"
      clientSecret: "YOUR_CLIENT_SECRET"
    allowedChatIds: []
```

### 多账户配置（推荐）

```yaml
channels:
  qqbot:
    enabled: true
    appId: "DEFAULT_APP_ID"
    clientSecret: "DEFAULT_CLIENT_SECRET"
    accounts:
      bot1:
        name: "主机器人"
        appId: "APP_ID_1"
        clientSecret: "SECRET_1"
        allowFrom: ["*"]
      bot2:
        name: "备用机器人"
        appId: "APP_ID_2"
        clientSecret: "SECRET_2"
        allowFrom: ["GROUP_ID_1", "USER_ID_1"]
```

## API 使用

### 基础消息发送

```typescript
import { QQManager } from './runtime';

// 在 QQManager 中使用 SDK
async function sendExample(manager: QQManager) {
  // 发送文本
  const result = await manager.sendText(
    { mode: 'c2c', id: 'USER_OPENID' },
    'Hello from SDK!',
    'REPLY_TO_MESSAGE_ID'  // 可选：被动回复
  );

  // 发送媒体
  await manager.sendMedia(
    { mode: 'group', id: 'GROUP_OPENID' },
    'https://example.com/image.png',
    '图片描述文字',
    'REPLY_TO_MESSAGE_ID'
  );

  // 主动消息
  await manager.sendProactiveMessage(
    'USER_OPENID',
    '这是一条主动消息'
  );
}
```

### 使用 SDK 函数直接发送

```typescript
import {
  sdkSendText,
  sdkSendMedia,
  sdkSendProactiveMessage,
  type ResolvedQQBotAccount
} from './sdk-adapter';

async function directSend(account: ResolvedQQBotAccount) {
  // 发送文本
  const result = await sdkSendText(
    account,
    'USER_OPENID',
    'Hello!',
    'REPLY_TO_MESSAGE_ID'
  );

  if (result.error) {
    console.error('Send failed:', result.error);
  } else {
    console.log('Message sent:', result.messageId);
  }
}
```

## 消息限流机制

SDK 自动处理 QQ Bot 的限流规则：

```typescript
// 被动回复限制（1小时内最多4次）
const result = await sdkSendText(account, to, text, replyToId);

// 如果超过4次或超过1小时，自动降级为主动消息
// 你也可以手动发送主动消息：
const proactiveResult = await sdkSendProactiveMessage(account, to, text);
```

## 多媒体标签

SDK 支持在消息文本中使用特殊标签：

```typescript
const message = `
Hello! Here are some files:

<qqimg>/path/to/image.png</qqimg>

<qqvoice>/path/to/voice.silk</qqvoice>

<qqvideo>/path/to/video.mp4</qqvideo>

<qqfile>/path/to/document.pdf</qqfile>
`;

await sdkSendText(account, userId, message);
```

## 迁移指南

### 从旧版本迁移

1. **配置文件更新**：
   - 将 `channels.qq` 改为 `channels.qqbot`（可选，向后兼容）
   - 使用新的多账户配置格式（推荐）

2. **代码更新**：
   - 导入路径：`./api` → `./sdk-adapter`
   - 函数签名基本保持不变
   - Token 管理完全自动化，无需手动处理

3. **功能增强**：
   - 启用后台 Token 刷新
   - 使用新的多媒体标签
   - 配置多账户支持

## 故障排除

### 常见问题

**Q: Token 获取失败？**
A: 检查 `appId` 和 `clientSecret` 配置，确保 QQ Bot 已审核通过。

**Q: 消息发送失败？**
A: 检查是否超过被动回复限制（1小时4次），SDK 会自动降级为主动消息。

**Q: 多媒体消息发送失败？**
A: 确保文件路径正确，且文件大小不超过限制（图片8MB，视频100MB）。

## 参考

- [QQ Bot 官方文档](https://bot.q.qq.com/wiki/)
- SDK 源码：`package/qqbot/src/`
- 适配层：`src/lib/server/channels/qq/`
- [openclaw-qqbot](https://npmx.dev/package/openclaw-qqbot)
