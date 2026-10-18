# 进度

新增真实 Runner 两个复现：备用失败/成功均因发送 HISTORICAL ANSWER 失败。新增原生 adapter 恢复测试。实现固定恢复 admission 状态、原生 History 计数及 messagesSince 入口；首次绿跑暴露新增测试误读 run-summary 路径，已改用 store 的正式入口。

三个新增场景通过；fault injection 删除 importedMessageCount 保护后，真实恢复用例因 OLD CONVERSATION ANSWER 泄入结果而失败，已恢复。相关旧测试首次 83/84 通过，唯一失败为沙盒阻止本地代理监听，获批单项复跑通过。定向 TypeScript 检查通过。

最终验证：三个新增场景连续 5 次通过；受影响 Runner/适配器/持久会话 84/84 全部通过（仅依赖本地沙盒代理的相关用例使用获批执行权限）；定向 TypeScript 检查通过；git diff --check 通过。
对抗审查：恢复 admission 不再由运行中文件存在性改变；真正恢复仍能提取已提交的本轮答案且不重新请求模型；导入历史仍保留给模型，但不参与本轮结果与工具效果判定；共用 Runner，无渠道特判。既有其他任务的 SDK 字段修改保留。
交付范围：源码修复，未修改用户历史、未重放外部消息、未重启正在使用的服务。无 UI/原生代码变更，无设置字段变更，能力矩阵和入口不变。
