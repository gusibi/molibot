# Task Plan

## Goal
对比示例项目与当前项目的 system prompt 组织方式，基于 `docs/prompt_desc.md` 的职责定义，优化仓库代码逻辑，并同步优化 `/Users/gusi/.molibot` 下的 markdown 提示词文件。

## Phases
| Phase | Status | Notes |
|---|---|---|
| Inspect current prompt architecture | completed | 已对比 example、当前 runner、文档与 `~/.molibot` |
| Decide target prompt ownership | completed | 已确定 system prompt 回到代码，profile 文件保留外部 |
| Implement code changes | completed | `runner.ts` 改为代码持有 runtime system prompt，默认 AGENTS 模板瘦身 |
| Update docs and md prompts | completed | 已更新 `docs/prompt_desc.md`、`features.md`、`prd.md` 与 `~/.molibot/*.md` |
| Verify behavior | completed | 已执行 `npm run build` 通过 |

## Risks
- `/Users/gusi/.molibot` 位于工作区外，若要写入可能需要提权。
- 需要避免破坏现有 prompt 覆盖能力或用户自定义能力。

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|

## 2026-02-28 Addendum: `package/mory` 独立 SDK 化
- [x] Phase 1: 核对 `package/mory` 当前 README / package manifest / 适配器能力边界
- [x] Phase 2: 为独立 SDK 补齐自带 driver 所需依赖声明
- [x] Phase 3: 实现包内 SQLite / PostgreSQL driver 与工厂函数
- [x] Phase 4: 补强 SQLite embedding 落库与基础向量检索
- [x] Phase 5: 更新 README、`features.md`、`prd.md`
