# Task Plan

## Goal
在不改上层 agent 调用面的前提下，为 memory gateway 增加可切换的 Mory SDK 后端。默认继续使用文件记忆；当设置页启用并配置后，由 gateway 切换到底层 Mory 实现。

## Phases
| Phase | Status | Notes |
|---|---|---|
| Inspect current memory flow and Mory SDK | complete | 已定位 gateway、设置页、现有文件后端、SDK 能力 |
| Design provider switch at gateway | complete | 复用 `settings.plugins.memory.core` 作为切换位 |
| Implement Mory-backed gateway path | complete | 新增 `MoryMemoryCore`，gateway 注册 `mory` provider |
| Verify with tests/build | complete | `npm run build` 通过 |
| Update docs tracking files | complete | 已更新 `features.md`、`prd.md` |

## Decisions
- 默认 provider 保持 `json-file`。
- provider 切换只放在 gateway 层，对外 API 保持不变。
- Mory 适配层保留现有 `MemoryRecord` 结构，对内使用 SDK SQLite storage/engine。

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| `features.md` 新增条目编号与既有 `ENG-126` 冲突 | 1 | 改为新的唯一编号 `ENG-128` |
