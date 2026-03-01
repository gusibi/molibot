# Findings

- 待补充。

- `MemoryGateway` 已经支持通过 `settings.plugins.memory.core` 选择底层 core，目前仅注册 `json-file`。
- 上层入口统一经过 gateway：API 在 `src/routes/api/memory/+server.ts`，agent tool 在 `src/lib/server/mom/tools/memory.ts`，满足“只改 gateway 层”的约束。
- 设置页目前是 Memory 管理页，不是 provider 配置页；需要再看运行时设置保存入口。
- `JsonFileMemoryCore` 支持的完整能力包括：增删改查、flush 从 session 提取、sync 外部 Markdown 记忆文件。
- `package/mory/src/moryIntegration.ts` 明确说明推荐接入点就是现有 `memory/` 栈里的 `types.ts`、`jsonFileCore.ts`、`gateway.ts`，说明 SDK 设计本身就是为 gateway 适配准备的。
- 运行时 settings 已支持 `plugins.memory.enabled` 和 `plugins.memory.core` 持久化，不需要新开配置通道，只要在设置页暴露并写回 `/api/settings` 即可。
- `MoryEngine` 提供 `ingest`、`retrieve`、`readByPath`，底层 `StorageAdapter` 提供 `list/readById/update/archive`；因此可以在 gateway core 适配出现有的 `add/search/update/delete` 语义。
- `/settings/plugins` 已经是正式的插件配置入口，当前只差把 `memoryCore` 的选项从 `json-file` 扩展到 `mory`。
- Telegram bot workspace 位于 `${DATA_DIR}/moli-t/bots/<botId>`，现有文件记忆同步逻辑扫描 `${DATA_DIR}/memory/moli-t/bots/**/MEMORY.md`；Mory core 如需兼容导入，可以复用同一路径约定。
- `MoryMemoryCore` 采用 gateway 内部适配方式：对外仍返回既有 `MemoryRecord` 结构；对内使用 `@molibot/mory` 的 SQLite storage + engine 完成落库初始化和 SDK 持久化。
- provider 切换位最终落在 `settings.plugins.memory.core`：`json-file` 继续默认，`mory` 为显式选择。
- `searchAll` 这类管理页需求通过 Mory core 维护 scope 索引实现，避免上层 API 变化。
