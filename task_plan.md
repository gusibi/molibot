# Task Plan

## Goal
分析并分阶段实施 Feishu / Telegram 接入的插件化改造，目标是未来新增平台或模型插件时尽量不改核心代码。

## Phases
- [completed] 1. 读取 PRD、features 和现有目录结构
- [completed] 2. 梳理 Feishu / Telegram / DeepSeek / runner / runtime 的耦合点
- [completed] 3. 设计插件化边界与最小改造方案
- [completed] 4. 输出实施建议，并补充文档记录
- [completed] 5. 第一阶段重构：mom runtime 去 Telegram 语义化
- [completed] 6. 第二阶段重构：runtime 改为统一 channel registry
- [pending] 7. 第三阶段：配置与持久化改为插件通用 schema
- [pending] 8. 第四阶段：外部/安装式 channel/provider plugin 注册

## Decisions
- 使用文件化计划记录分析过程
- 将“渠道插件注册架构”补充进 PRD，避免后续实现目标不一致
- 本轮先完成核心命名与 runtime 生命周期解耦，不在同一轮引入动态插件安装
- memory 不复用 channel plugin 协议，改走独立的 backend/driver 抽象，并兼容旧的 `plugins.memory.core` 配置
- memory 的外部同步能力继续拆分为独立 importer/source；settings 插件页需要能展示 memory backend catalog
- 启动日志需要覆盖 plugin catalog、channel 实例应用结果、memory backend/importer 选择与 startup sync 结果

## Errors Encountered
- None

## 2026-03-01 Feishu Media Fix
- Goal: 修复 Feishu 渠道仅支持文本的问题，让图片、语音/音频、文件消息能够进入统一 runner 输入。
- Discovery:
  - 当前 `src/lib/server/plugins/channels/feishu/runtime.ts` 只在 `message_type === "text"` 时解析内容。
  - 非文本消息在 `cleaned` 为空时被提前丢弃，`attachments` / `imageContents` 永远为空。
  - Telegram 运行时已经实现完整的附件下载、图片注入、语音转写链路，可直接复用设计。
- Plan:
  - 在 Feishu runtime 内补充消息体解析 helper。
  - 调用 `im.messageResource.get` 下载用户上传资源并落盘到 `attachments/`。
  - 对 `image` 注入 `imageContents`，对 `audio/media` 调用现有 STT 路由并附加 `[voice transcript]`。
  - 保持 runner 契约不变，只修渠道入站归一化。

## 2026-03-01 Feishu Duplicate Response Follow-up
- Goal: 排查并修复 Feishu 同一条消息重复响应的问题。
- Discovery:
  - Feishu 适配器使用 WebSocket 事件订阅，不存在主动“拉取”消息的轮询逻辑。
  - `FeishuManager.stop()` 未显式关闭旧的 `WSClient`，runtime 若重复 `apply()` 可能残留多个订阅连接。
  - Feishu 适配器缺少基于原始字符串 `message.message_id` 的本地幂等去重。
- Plan:
  - 在 `runtime.ts` 的 stop 生命周期里主动关闭当前 `WSClient`。
  - 在 Feishu 适配器入站最前面增加 raw message id 去重，避免重复资源下载、STT 和重复 runner 执行。
  - 保留通用 `store.logMessage()` 作为第二层兜底。
