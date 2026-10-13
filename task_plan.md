# Feature UI automation

## Goal
Run development verification automatically against the desktop UI, with isolated API/runtime evidence and honest native/system coverage. No release workflow changes.

## Phases
1. Inspect startup, isolation and existing tests — in progress.
2. Implement deterministic UI harness and high-risk scenarios.
3. Add real App driver where supported and API regression selection.
4. Run checks, exercise failure detection, document commands and coverage.

## Acceptance
One development command starts isolated services, runs UI scenarios, reports failures with screenshots/logs, and cleans up. Message/approval/navigation/settings paths have executable tests. No owner data or service is touched. Missing environment coverage is reported explicitly.

## Pi capability completion — 2026-10-13
Goal: finish authorized A/B/C/D implementation and isolated acceptance; preserve existing work, no commit.
1. Shared native model operation ownership, approvals, budgets, receipts and media — in progress.
2. Extension cancellation, command scope and production acceptance — pending.
3. OAuth deployment callback, step-up continuation and race guards — pending.
4. Non-Room recovery and Web review presentation — pending.
5. Full core, build, desktop/native checks and document reconciliation — pending.
External account/paid Provider acceptance requires supplied resources; never use owner data.

### Pi capability completion — 2026-10-13 收尾

- [x] A/B/C/D 本地实现、生产入口回归、文档与四态矩阵同步。
- [x] 核心 805 通过/1 环境跳过；新增主回归 65 项连续 5 次；UI Chromium/WebKit 各 5 次；Rust 70；类型与构建通过。
- [x] 隔离原生 App 首次授权、页面/Session 切换、托管服务重启及强杀恢复；测试进程退出，用户 App 保持运行。
- [x] 真实账号/付费验收按用户明确决定跳过，保留边界。
- [x] 既有 desktop:test 的 profile-files scope 失败单独记录，未修改其他任务的 API/权限配置。

### 版本 review 的五项缺陷修复 — 2026-10-13

- [x] 五项红回归与完整修复：流 result 终态、参考图流限额、事件稳定身份、OAuth deadline signal、原生共享规则 API。
- [x] 相关 161 项连续 5 轮；核心 812 通过/1 缺 fd 跳过；桌面 327、Rust 70，检查与构建通过。
- [x] 共享规则双浏览器各 5 次和独立原生 App 保存、Session 切换、重启、SIGKILL 恢复回读。
- [x] 双轴只读复审、文档同步；不提交，真实账号与付费验收仍跳过。
