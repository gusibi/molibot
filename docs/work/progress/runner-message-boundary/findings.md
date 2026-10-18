# 发现

2026-10-18 QQ run 在主/备模型均失败后把 4 月历史的第一条答复当 finalText，并发送其他 6 条历史回复。isRecovering 动态检查 sqlite 是否存在，第一次请求创建文件后，在备用模型开始时变为 true，将 beforeAttempt 清零。真正重启恢复同样不能将初始化导入的 History 条目当本轮产物。

原生 ledger 已标记 molibot.runner-history，并且投影时排除；共享结果读取复用这条来源边界。现有 Runner 模型重试测试无历史，原生恢复测试同样无历史，未覆盖该组合。
