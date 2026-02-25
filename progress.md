# Progress

## 2026-02-11
- 完成 `CustomProviderConfig` 数据结构升级（多模型 + 角色能力）。
- 完成 settings 读写层兼容迁移（旧 `model` 自动兼容）。
- 新增 Provider 测试 API：`POST /api/settings/provider-test`。
- 重构 `/settings/ai` 为双栏布局：左侧可搜索 provider 列表，右侧 provider 详情编辑。
- 右侧详情支持：字段编辑、多模型增删、默认模型、支持角色展示、Provider 测试。
- 实现 Telegram pi 调用 developer 角色不兼容兜底映射。
- 验证：`npm run build` 通过；`npm --prefix web run build` 仍因既有依赖打包问题失败（`@smithy/node-http-handler` browser externalization）。

## 2026-02-25
- 新增 `telegramBots[]` 配置结构（兼容旧单 bot 字段回填）。
- Runtime 改为多实例应用：按 bot id 维护 `TelegramManager` Map，配置变更时增量启动/停止对应 bot。
- Telegram 设置页改为多 bot 列表编辑（增删 bot、bot id/name/token/allowed chat ids）。
- 修复 Telegram 配置热更新边界：token 相同但 allowed chat ids 变化时也会重载。
- 验证：`npm run build` 通过。
- 事件系统新增 `delivery` 模式：`text` 直发文本，`agent` 先执行 AI 再回复；one-shot/immediate 缺省改为 `agent`。
- `EventsWatcher` 的回调升级为支持异步，状态 `completed/error` 现在可基于异步执行结果更新。
- 更新了 runner 事件规范示例与 write 工具提醒规范化输出（默认写入 `delivery: "text"`）。
- 追加修复：event watcher 在读取事件时会自动补全并回写 `delivery`（缺省为 `agent`），避免磁盘文件和实际执行模式不一致。
