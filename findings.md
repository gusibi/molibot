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
