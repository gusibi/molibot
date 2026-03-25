# Progress

## 2026-03-21
- 读取 AGENTS/prd/features/acp 相关实现，确认现状。
- 校验本机 `claude` / `claude-code-acp` / `codex` 安装状态。
- 确认需要新增 provider/profile 分层，并做旧配置兼容。
- 新增 `src/lib/server/acp/providers/`，拆出 `codex.ts` 与 `claude-code.ts`，把 preset / auth hint / adapter 识别集中管理。
- 扩展 ACP target schema，新增 `adapter` 字段；默认设置改为内置 Codex + Claude Code 两个 preset，并兼容旧配置自动推断 adapter。
- 统一 Telegram ACP 帮助文案与状态展示，远端 adapter 命令改为带 provider 前缀显示（如 `codex:/...`、`claude-code:/...`）。
- 更新 `/settings/acp`，新增 adapter 字段与 Codex / Claude Code / Custom 三种 target 添加入口。
- 更新 `features.md` 与 `prd.md` 记录本次交付。
- `npm run build` 受沙箱阻止（`.svelte-kit` 写入权限），改用 targeted `tsc` 校验本次改动文件并通过。

## 2026-03-25
- 建立本次分层重构计划文件。
- 下一步先读各渠道 runtime，确认哪些命令与会话逻辑已经重复，哪些只在 Telegram 独有。
- 已完成共享命令层抽取：公共文本命令与会话控制统一进入 Agent 层，Telegram/Feishu/QQ/Weixin runtime 改为调用共享服务。
- 已清理各渠道中残留的公共命令实现，只保留平台专属逻辑，例如消息解析、附件处理、回复发送和 Telegram 的 `/chatid`。
- 已完成文档同步与代码检查：变更文件通过逐文件转译检查；完整类型检查和整包构建仍受仓库现有错误与当前环境写权限限制。
