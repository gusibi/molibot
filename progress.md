# Progress

- 2026-10-12: inspected existing tests, preview transport, native startup and capability scope. Working tree initially clean.

- Initial message E2E passes. First multi-case run was blocked by the first-launch dialog; helper now dismisses it through the UI. WDIO installation requires explicit denied build scripts for unused external browser drivers.

## Pi completion — 2026-10-13
- User authorized completing all four units. Read runtime skill and prior audit; working-tree modifications preserved.

- 2026-10-13: native model ownership + stable call budgets/usage, media provenance, semantic unknown-request guard and raw response reuse implemented. Real Runner Codemode/extension/manual/Plan/command scenarios pass (5). Non-Room runtime restart review approve/reject passes (2); OAuth deployment callback, step-up safe-read continuation, concurrent login and late exchange guards pass against local HTTP fixtures (17). Further production stream/Deferred, UI/native cold path, full-core checks and documentation remain.

### Pi capability completion — 2026-10-13

已补齐本地实现及隔离验收，未提交。根/桌面类型与构建通过，核心 805 通过/1 缺 fd 跳过，Rust 70 通过，新增主回归 65 项连续 5 次通过，UI 两个浏览器各 5 次通过。真实第三方资源验收由用户明确决定跳过。既有 profile-files HTTP scope 测试失败另列。参见 Pi validation/handoff；本节不改变前面的 UI 自动化任务记录。

### 整体版本审查修复 — 2026-10-13

5 项 review 缺陷已修复，机器守卫先红后绿，相关 161 项连续 5 轮通过。完整核心 812/1环境跳过，桌面 327 和 Rust 70 通过。原生共享规则冷路径已实际验收。此前 HTTP scope 失败消除，使用已授权 Desktop profile API而未扩大白名单。证据：`docs/work/progress/pi-capability-completion/review-fixes.md`。
