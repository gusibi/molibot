# Task Plan

## Goal
把各渠道里不该各自维护的公共命令/会话控制逻辑抽离出来，收敛到共享层；保留渠道自己的解析、附件、发送等差异化逻辑。

## Phases
- [in_progress] 盘点 Telegram / QQ / Weixin / Feishu 当前分层和重复点
- [pending] 设计共享命令与会话控制边界
- [pending] 实现共享层并让 Telegram 接入
- [pending] 评估并接入其他渠道中可无痛迁移的公共逻辑
- [pending] 更新文档并完成验证

## Constraints
- 不回退用户已有改动
- 每次改动后更新 `features.md` 和 `prd.md`
- 能验证的都先验证

## Errors Encountered
- 暂无
