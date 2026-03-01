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
