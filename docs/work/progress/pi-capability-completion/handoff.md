# Pi 能力补齐交接

更新：2026-10-13。分支：`master`。本次改动未提交，保留用户统一验收约定；工作区同时包含其他任务的改动，不能整体回退或整理。

A/B/C/D 本地实现已补齐，当前范围和边界见[规格](../../../requirements/pi-capability-completion-spec.md)，实际验证及限制见[验收记录](validation.md)，扩展方法表见[接口说明](../../../guides/pi-extension-runtime.md)。真实第三方 OAuth 和付费模型验收已由用户明确决定先跳过。

## 关键实现

- A：`piRecovery.channelReview.test.ts` 通过真实服务启动、进程强杀及 Desktop 审批入口覆盖批准/拒绝，核对前不重发、原渠道投递一次。渠道 transcript 在 Agent Context；Web SessionStore 元数据不是它的消息来源。
- B：`mcp/oauth.ts` 复用 Pi 公共 OAuth 协议；Web 一次性 callback route 转发至固定私有 listener，state/issuer/PKCE 仍由 Pi 校验。Provider 按 scope/revision 缓存共享刷新；新授权保留 granted/default/challenged scopes；退出、删除、资源变更和 Stop 不接受迟到结果。
- C：`models/ownedModelOperations.ts` 创建隐藏的原生模型子工具；`nativeModelResult.ts` 以 Pi 公共 entry 持久 intent/response。语义未知结果守卫不能删除；model 工具的 safe replay 依赖这个守卫，不表示收费调用可以直接重发。图片使用共享媒体任务与制品；分类/stream 使用稳定 receipt，避免图片重复入账。
- D：`processClient.ts` 用 AsyncResource 保留原生调用上下文，signal 与每个嵌套请求的取消绑定原 owner。结束后 token 和迟到响应失效。命令经普通 Runner 创建原生工具执行。`compact()` 使用显式原生压缩，并从原生 UsageDoc 投影独立压缩用量；普通自动压缩仍遵循既有宿主策略。

## 验证注意事项

测试只使用临时数据目录和本地模拟服务。子进程必须使用 `evals/lib/isolatedEnv.mjs` 或等价的全部数据路径覆盖，避免继承 dotenv 注入的真实用户路径。跨进程恢复 fixture 必须移除 `NODE_TEST_CONTEXT`，并按 fixture 约定开启启动恢复检查。

原生验收脚本在 `tests/pi/native-harness.ts`。测试 bundle 使用独立 identifier 和数据目录；macOS 必须通过没有 symlink 祖先的规范路径启动，不能绕过 Tauri 路径保护。验收期间不要终止用户正在运行的 App 或服务。

不提交、不发布、不使用真实账号、不产生模型费用。外部资源验收恢复时先取得具体目标与授权，再追加实测证据。

## 版本审查修复

v2.9.63 到当前工作区的双轴审查发现 5 项问题，均已修复并通过回归及只读复审，见[修复记录](review-fixes.md)。此前共享规则 HTTP scope 失败已消除，桌面测试全绿；继续保留不提交与真实 Provider 验收跳过的约定。
