# Progress

- 2026-03-01: 初始化规划文件，开始梳理 memory gateway 与 Mory SDK 接入点。
- 2026-03-01: 完成第一轮结构检查，确认可在 gateway 层增加第二个 memory core，不需要改 agent/tool 调用面。
- 2026-03-01: 开始检查运行时 settings 持久化和 MoryEngine API，准备设计 gateway provider 切换方案。
- 2026-03-01: 确认 `plugins.memory.core` 已具备持久化能力，适合直接扩展为 `json-file | mory` 两种后端。
- 2026-03-01: 确认插件设置页已具备 memory core 切换表单，只需补上 `mory` 选项和对应 gateway core。
- 2026-03-01: 新增 `src/lib/server/memory/moryCore.ts`，把 Mory SDK 接到 memory gateway 下，默认仍走 `json-file`。
- 2026-03-01: `/settings/plugins` 增加 `mory` 选项，`/settings/memory` 增加当前 memory core 展示。
