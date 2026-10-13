# v2.9.63 后变更的审查修复

日期：2026-10-13。范围为整体版本审查的 5 项缺陷；没有修改其它任务的行为。未提交、未发布。真实第三方账号和付费模型验收继续按用户决定跳过。

| 缺陷与根因 | 修复 | 回归守卫 |
| --- | --- | --- |
| stream.result 提前返回；异步接口契约错误 | 终态 Promise 由成功/失败结算，result 无需先遍历事件 | `modelStream.test.ts` 验证 host barrier 后的消息及错误；修复前两个用例均失败 |
| 参考图完整缓冲后才限额；输入资源边界错误 | 每块累计字节，超限取消 reader；内联按 base64 解码大小校验 | `modelOperations.test.ts` 验证没有模型请求、超限 cancel 和未读剩余块；两个用例修复前失败 |
| 事件调用 ID 重复；调用身份缺少 owner 维度 | 稳定 hash 包含 run、扩展、事件、handler、原生 task 和父 toolCallId | `eventBridge.test.ts` 验证两个扩展各两 handler、两个父工具的独立身份，恢复同一父工具身份稳定；修复前失败 |
| OAuth 超时后重发；取消跨层丢失 | 授权等待继承 transport 的有效 deadline signal，授权后再次检查取消 | `oauth.e2e.test.ts` 真实本地协议验证超时后授权成功但 tools/call 仍只发一次；修复前出现两次 |
| 共享规则原生请求被拒；API 与 native scope 不一致 | 复用已授权 Desktop profile endpoint，增加 global 读写作用域 | API 精确路由断言、profile route 临时文件 round-trip 与原 HTTP scope 守卫；修复前失败，USER.md 保存后不变 |

这些问题已有机器守卫；共享规则命中 CLAUDE.md 第 54 条的同类前科。此前测试只验证请求带 global scope，浏览器 preview 又绕开 Tauri，所以没有证明原生链路可用。新增真实 endpoint round-trip、精确客户端路由和原生走查，不重复追加长期规则。

## 验证

- 相关 161 项回归连续 5 轮通过，无重试。
- 完整核心回归：812 通过，0 失败，1 因缺少 fd 跳过。
- `desktop:test`：327 项通过；Rust：70 项通过。
- 根 `check/build`、`desktop:check`、桌面前端 build 通过；桌面检查有 1 条已有警告。类型检查在构建结束后单独运行，避免并发 sync 重写生成文件。
- 共享规则 Playwright：Chromium/WebKit 各 5 次通过，验证保存走 Desktop API、隔离服务重启后回读。
- 原生 App 使用独立 bundle、临时目录和本地模型：首次加载 → 保存 → 页面切换 → 托管服务重启回读 → Second 会话切换 → 隔离服务 SIGKILL → Supervisor 恢复后回读。测试 App 和本地服务已退出。
- Standards/Spec 两轴只读复审没有发现新的可确证问题；Spec 复审重跑了 OAuth 超时协议复现。

Desktop profile route 回归已纳入 `test:desktop-chat`。所有持久化与协议测试使用临时数据和模拟服务；没有真实账号或费用。
