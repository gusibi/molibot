# Findings

- 当前 `src/lib/server/acp/service.ts` 是通用 JSON-RPC 壳，但默认 target、auth hint、project 默认 allowlist、帮助文案都绑定到 Codex。
- 当前设置默认值只内置了 `codex` target，`/acp add-project` 也默认只允许 `codex`。
- ACP UI 仅展示 Codex preset，没有 Claude Code preset，也没有显式 adapter/provider 字段。
- 本机已安装 `claude` 2.1.3、`claude-code-acp`、`codex` 0.92.0。
- 官方/主来源确认：
  - Codex ACP 由 `zed-industries/codex-acp` 提供。
  - Claude Code ACP 由 `@zed-industries/claude-code-acp` 提供，README 说明可直接运行 `claude-code-acp`，并支持 `ANTHROPIC_API_KEY=... claude-code-acp`。
- 本机安装的 `@zed-industries/claude-code-acp` 包 README 标题为 “ACP adapter for Claude Code”，包描述为 “powered by the Claude Code SDK”。
