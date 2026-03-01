# Findings

## Documents
- `prd.md` 已明确目标：新增渠道不应改核心 pipeline（P2-01）。
- `prd.md` 已记录 prompt 侧需要 adapter-selectable channel sections（P1-36），说明当前系统已经意识到 channel-specific prompt 是一个耦合点。
- `features.md` 显示当前 memory 已经做成 gateway/plugin 模式，可作为渠道插件化的参考设计。

## Current Coupling
- Runtime 启动层直接 import 并管理 `TelegramManager` / `FeishuManager`，新增渠道必须改 `runtime.ts`、settings 类型、apply 流程。
- 配置模型按平台写死：`RuntimeSettings` 直接包含 `telegramBots` / `feishuBots`，设置 API 和前端设置页也按平台拆开。
- mom 运行时上下文仍以 Telegram 为默认真相：`TelegramInboundEvent`、`TelegramMomStore`、`RunnerPool`、memory tool 中都有 `channel: "telegram"` 硬编码。
- `prompt-channel.ts` 只声明 `telegram`，说明 prompt 插槽虽已抽出，但插件协议还没成立。
- Feishu 适配层大量复用 Telegram 命名/类型/存储，属于“复制一份再改”的接入，不是正式插件边界。

## Memory Architecture
- `memory` 现有结构更适合定义为 backend/driver 层，而不是复用 channel plugin 协议：它有统一 gateway 和稳定 CRUD/search/flush 接口，但没有 channel manager 那种实例生命周期。
- 适合插件化的是 memory 存储后端，例如 `json-file`、`mory`、未来的远程 memory service；不适合插件化的是 memory 领域模型、prompt 注入语义、冲突治理规则。
- 为兼容现有配置，运行时和设置持久化应优先读取新字段 `plugins.memory.backend`，同时兼容旧字段 `plugins.memory.core`。
- 已完成进一步拆分：外部同步不再属于 backend 接口，而是独立 importer/source；当前内建实现为 Telegram legacy memory file importer。
- memory backend catalog 已补进 plugin catalog，设置页现在可以和 channel/provider 一样看到当前内建 backends。

## 2026-03-01 Feishu Media Intake
- 用户反馈 Feishu 当前只能识别文本，图片、语音和其他文件都进不了对话链路。
- `src/lib/server/plugins/channels/feishu/runtime.ts` 现状是仅在 `message.message_type === "text"` 时提取内容。
- 同文件虽然构造了 `attachments` 和 `imageContents` 字段，但 Feishu 路径从未填充它们。
- 非文本消息因为 `cleaned` 为空，在进入 runner 之前就被 `message_ignored_empty` 逻辑丢弃。
- 参照实现位于 `src/lib/server/plugins/channels/telegram/runtime.ts`：它已经覆盖 `document/photo/voice/audio` 下载、附件保存、图片注入、STT 转写和 transcript 注入。
- Feishu SDK 已提供 `client.im.messageResource.get({ path: { message_id, file_key }, params: { type } })` 用于下载用户消息中的资源文件。
- 用户现场日志显示：语音消息下载时 `file_key` 为 `file_v3_*`，但请求参数 `type=media` 返回 HTTP 400。这说明飞书音频资源并不总能按 `media` 下载，至少存在一类消息必须按 `file` 资源路径取回。
- 因为飞书不同消息体字段与资源下载 `type` 的对应关系并不完全稳定，本轮实现补充了基于 `message_type + file_key 前缀` 的候选类型回退，而不是单一硬编码映射。
- 本轮修复策略是复用 Telegram 的 runner 输入约定，不改 runner，只补 Feishu 入站归一化。

## 2026-03-01 Feishu Duplicate Response
- Feishu 当前不是“主动拉取消息”，而是通过 `@larksuiteoapi/node-sdk` 的 `WSClient` 订阅 `im.message.receive_v1` 事件。
- `src/lib/server/plugins/channels/feishu/runtime.ts` 中的 `stop()` 之前没有真正关闭 `WSClient`，只是清空实例引用；如果 runtime 发生重复 `apply()`，旧连接仍可能继续收消息，形成重复处理。
- 现有通用去重依赖 `MomRuntimeStore.logMessage(chatId, { messageId: number })`，而 Feishu 入站在 `message-intake.ts` 中把原始字符串 `message.message_id` 压缩成数字再进入该层，适配器缺少对原始 id 的幂等控制。
- 用户截图中的两类异常其实叠加存在：
  - `transcriptionError` 会先额外发送一条 STT 降级提示；
  - 如果同一入站事件被重复投递或重复订阅消费，主回复会再次发送，形成“同答案出现两次”的观感。
