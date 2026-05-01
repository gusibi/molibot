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

## 2026-04-24
- 启动 AI Providers / Routing 融合与响应式样式优化。
- 已重置 `task_plan.md` 为本次设置页优化计划，并新增 `findings.md` 记录发现。
- Browser Use 当前无法连接可用 in-app browser pane；本轮先基于源码推进，后续用编译解析验证页面。
- 确认核心割裂点在 UI 信息架构：后端模型选项已经是 mixed pool，Routing 页仍用 legacy PI/custom 字段表达成两套逻辑。
- 已将 Routing 页重构成“Unified model pool / capability routing / runtime defaults / compatibility fallback”结构。
- 已同步 Providers 页标题、说明、跳转入口和主要面板样式，使其表达 built-in/custom 共同进入同一模型池。
- 已更新 `features.md` 和 `prd.md`，记录 AI Providers / Routing 统一模型池设置体验。
- 验证：两个改动页面通过 Svelte compiler 编译解析。
- 完整 `npm run build` 仍失败在只读沙箱不允许写 `.svelte-kit/tsconfig.json`，未进入 Vite 构建阶段。

## 2026-05-01 QQBot SDK upgrade progress

- Started comparison of local package/qqbot against upstream openclaw-qqbot.
- Confirmed workspace has pre-existing unrelated dirty files; scope will stay on package/qqbot plus required docs.

- Synced package/qqbot source to upstream QQ Bot SDK v1.7.1 and patched Molibot runtime compatibility by replacing the unavailable plugin-sdk/core runtime import with local helpers plus type-only SDK imports.
- Updated package/qqbot package metadata to 1.7.1.
- Replaced obsolete remote-audio direct-upload assertions with stable outbound tests for missing credentials and user-facing media errors.
- Verified package build, focused outbound tests, and full Molibot production build.

- Adjusted QQ /bot-upgrade default to doc-only mode for Molibot; hot reload now requires explicit upgradeMode=hot-reload.

- 2026-05-01 follow-up: patched package/qqbot/src/gateway.ts so Molibot onEvent mode skips OpenClaw runtime preflight, approval gateway, SDK slash interception, and per-message runtime lookup.

## 2026-05-01 production auto-restart/update progress

- Added a production release bundle flow through `bin/molibot-release.sh` and `npm run release`.
- Updated `bin/molibot-service.sh` so managed processes can start from a release directory via `MOLIBOT_APP_DIR` and `MOLIBOT_START_COMMAND`.
- Added `bin/molibot-update.sh` for GitHub fetch/build/timestamped release/current symlink/restart deployment.
- Added Docker production files: `Dockerfile`, `.dockerignore`, and `docker-compose.yml`.
- Added `qrcode-terminal` as a direct production dependency because adapter-node externalizes the Weixin QR helper import.
- Added `bin/molibot-manage.js` and `molibot manage` for lightweight interactive install/update/service/uninstall operations.
- Added managed-directory safeguards so update/release/uninstall refuse to overwrite or remove non-empty directories without Molibot marker files.
- Added `/api/version` and the Web top-bar version popover for read-only GitHub update checks; browser UI does not run update or restart actions.
- Added `/settings/system` for language, runtime timezone, and read-only GitHub/deployment version fields; widened the Web version badge for readable version text.
- Set default GitHub source to `https://github.com/gusibi/molibot` branch `master` in update script, manager defaults, and version API.
- Fixed update bootstrap for cloned sources that do not yet include `bin/molibot-release.sh` by injecting current installer scripts into the managed clone before packaging; release bundles now also include `molibot-release.sh` when available.
- Added `mpg123-decoder` as a root production dependency and taught release packaging to self-heal missing root runtime dependencies before building older source checkouts.
- Updated required docs: `readme.md`, `features.md`, `prd.md`, and `CHANGELOG.md`.
- Verified shell syntax with `bash -n`, ran `npm run build`, generated `dist/molibot-release` with `MOLIBOT_RELEASE_SKIP_BUILD=1 npm run release`, and smoke-tested `node build` from the release bundle via `/health`.
- Verified `bin/molibot-manage.js` with `node --check`, `node bin/molibot-manage.js --help`, `node bin/molibot.js --help`, a clean `npm run build`, release packaging, and release-bundled manager help.
