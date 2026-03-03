# Task Plan

## Goal
为设置页新增 `Agent` 管理能力，支持：
- 维护 agent 列表与 bot-agent 关联
- 在设置页直接编辑 agent/bot 级 Markdown 文件
- prompt 加载时按 `global -> agent -> bot` 规则读取

## Phases
| Phase | Status | Notes |
|---|---|---|
| 1. Inspect current settings/runtime structure | completed | 已确认 schema、存储、UI 和 prompt 装配入口 |
| 2. Design agent data model and file layout | completed | 已确定兼容现有 channel/bot 的 `agents/` 方案 |
| 3. Implement backend settings and file APIs | completed | 已完成 agent 元数据、文件读写、bot 关联 |
| 4. Implement settings UI pages/forms | completed | 已完成 `/settings/agents` + Telegram/Feishu bot 关联和 bot 文件编辑 |
| 5. Update prompt loading and preview generation | completed | 已切换为 `global -> agent -> bot` |
| 6. Validate and update docs | completed | 已完成构建验证与 `features.md` / `prd.md` 同步 |

## Key Decisions
- `moli-t` / `moli-f` 继续视为 channel runtime，不承担 agent 语义。
- `agents/` 作为数据目录下的新平级目录。
- bot 页面只负责绑定 `agentId` 和编辑 bot 级覆盖文件；agent 页面负责编辑 agent 文件。

## Risks
- 现有 settings 兼容性：需要保证旧配置仍可读。
- 文件编辑 UX：需要避免保存空文件导致 prompt 来源混乱。
- prompt 预览依赖多处路径逻辑，改动后必须验证。

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
