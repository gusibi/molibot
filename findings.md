# Automatic Durable Execution 发现记录

## 当前假设

- 用户已确认 PRD 完善，可以开始实现；本轮默认按 PRD 的验收口径执行，不另造需求。
- 当前任务覆盖真实产品代码，而非只输出评审意见；若发现安全边界、数据迁移或产品行为存在无法安全推断的选择，会在实施前停下确认。

## 待核对

- PRD 的目标、Must/Should 范围与明确验收条件。
- 既有 durable execution、watched events、scheduler、lease、队列、runner 和 session 持久化实现。
- `CHANGELOG.md`、`docs/archive/changelog-*.md` 与 `CLAUDE.md` 中的历史坑点。
- 现有测试命令、数据库注入方式和 UI/渠道冷启动验证约定。

