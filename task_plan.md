# Task Plan

## Goal
让 Molibot 支持生产环境不接源码目录运行，并提供从 GitHub 拉取最新代码、构建 release 制品、原子切换、自动重启的部署路径；本地开发模式保持基于源码启动。

## Assumptions
- 本地测试继续使用 `molibot dev` / `npm run dev`，不改变开发热更新路径。
- 生产优先支持 release bundle 目录运行，同时补充 Docker 镜像路径。
- 自动更新脚本可以在部署机上访问 GitHub 仓库和 Node 22+ / npm。
- 不把本机绝对路径写入代码或文档示例。

## Phases
- [completed] 盘点现有启动、构建、service 脚本与源码依赖点
- [completed] 增加 release bundle、service 启动目录、GitHub 自动更新和 Docker 文件
- [completed] 增加轻量交互式安装/管理 CLI
- [completed] 增加 Web 右上角版本显示和只读更新检测
- [completed] 增加系统配置页和更清晰的版本徽标
- [completed] 更新 `features.md` / `prd.md` / `CHANGELOG.md` / `README.md`
- [completed] 执行构建与脚本语法验证

## Success Criteria
- 生产可从 release bundle 的 `current` 目录启动，不需要源码 checkout 参与运行。
- 自动更新脚本能 clone/fetch GitHub、构建、发布到 timestamped release、切换 `current` 并重启服务。
- Docker 镜像可以通过多阶段构建生成生产运行环境。
- 开发命令保持不变。
- `npm run build` 至少通过一次，新增 shell 脚本通过语法检查。

## Errors Encountered
- Release smoke server was started without a TTY, so stdin Ctrl-C could not stop it; stopped the owned temporary `node build` process by PID after `/health` verification.

## 2026-05-01 QQBot SDK upgrade

Goal: compare /Users/gusi/Github/openclaw-qqbot v1.7.1 with local package/qqbot v1.5.3 and upgrade local SDK where compatible with Molibot boundaries.

Plan:
1. Compare source modules and identify upstream capability groups. Verify by diff/stat.
2. Sync SDK-level source changes into package/qqbot, excluding standalone packaging/runtime pieces that conflict with Molibot. Verify by TypeScript build.
3. Patch Molibot adapter compatibility and tests. Verify targeted package build and repo checks where feasible.
4. Update project docs required by AGENTS.md. Verify docs mention shipped facts, not one-off implementation noise.

Assumptions:
- Keep Channel layer focused on QQ protocol/message conversion and media delivery.
- Do not move Molibot shared queue/session/orchestration into package/qqbot.
- Existing unrelated dirty files are user work and must not be reverted.

Progress update 2026-05-01:
- [complete] Compared upstream v1.7.1 against local package/qqbot.
- [complete] Synced SDK source and adapted Molibot runtime imports/helpers.
- [complete] Updated package metadata, tests, and required docs.
- [complete] Verified package build, focused test, and main build.
