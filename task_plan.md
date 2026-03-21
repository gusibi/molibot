# Task Plan

## Goal
为 Molibot ACP 增加 Claude Code 支持，并把 Codex / Claude Code 的接入行为统一到显式 provider 层，统一对外命令与展示，避免在 service 内散落 provider 特判。

## Phases
- [completed] 设计 provider/profile 结构与兼容策略
- [completed] 实现 ACP provider 拆分、schema/defaults/store 兼容
- [completed] 实现 Telegram/UI 统一展示与命令输出
- [completed] 更新 features.md / prd.md
- [completed] 运行可行验证（目标 TS 文件编译通过；完整 Svelte build 受沙箱写入限制）

## Decisions
- 对外继续统一使用 `/acp ...` 命令，不为 Codex / Claude Code 分裂 Telegram 控制面。
- 对内新增显式 adapter/provider 字段；旧配置通过命令模式自动推断，保持兼容。
- Codex 与 Claude Code 各自放到独立 provider 文件，service 只依赖通用 profile。
- 若 provider 有独有命令，仅在展示层加 provider 前缀区分，不改变 ACP 公共控制命令。

## Risks
- 旧 settings 中没有 adapter 字段，需要兼容回填。
- Claude Code ACP 的认证方式不能硬猜，只能基于官方 README 和本机已安装 adapter/CLI 做保守提示。

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `npm run build` failed with `EPERM` writing `.svelte-kit/tsconfig.json` | 1 | Switched to targeted TypeScript validation that does not need generated file writes |
| Full `tsc --noEmit -p tsconfig.json` shows pre-existing repo errors in unrelated files/deps | 1 | Ran focused `tsc` on the ACP/settings files changed in this task; it passed |
