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
