# Progress

- 2026-03-21: 读取 AGENTS/prd/features/acp 相关实现，确认现状。
- 2026-03-21: 校验本机 `claude` / `claude-code-acp` / `codex` 安装状态。
- 2026-03-21: 确认需要新增 provider/profile 分层，并做旧配置兼容。
- 2026-03-21: 新增 `src/lib/server/acp/providers/`，拆出 `codex.ts` 与 `claude-code.ts`，把 preset / auth hint / adapter 识别集中管理。
- 2026-03-21: 扩展 ACP target schema，新增 `adapter` 字段；默认设置改为内置 Codex + Claude Code 两个 preset，并兼容旧配置自动推断 adapter。
- 2026-03-21: 统一 Telegram ACP 帮助文案与状态展示，远端 adapter 命令改为带 provider 前缀显示（如 `codex:/...`、`claude-code:/...`）。
- 2026-03-21: 更新 `/settings/acp`，新增 adapter 字段与 Codex / Claude Code / Custom 三种 target 添加入口。
- 2026-03-21: 更新 `features.md` 与 `prd.md` 记录本次交付。
- 2026-03-21: `npm run build` 受沙箱阻止（`.svelte-kit` 写入权限），改用 targeted `tsc` 校验本次改动文件并通过。
