# Pi 能力补齐验收记录

日期：2026-10-13。范围：[Pi 能力补齐规格](../../../requirements/pi-capability-completion-spec.md)的 A/B/C/D 本地实施。真实第三方 OAuth、分类/图片 Provider 与付费调用已由用户明确决定跳过。

## 可观察证据

| 范围 | 生产入口与断言 |
| --- | --- |
| A 渠道恢复 | `piRecovery.channelReview.test.ts` + `pi-room-review-worker.ts`：真实 Runner 请求期间 SIGKILL，重启经真实启动协调器生成核对 Decision Request；决定前不再请求，Desktop 审批批准继续并只投递一次，拒绝终止。原来源的 Agent Context 保存答案一次。Room、三窗口、服务租约、预算与 Stop 继续运行核心回归。 |
| B OAuth | `oauth.e2e.test.ts`：本地授权服务器及 HTTP MCP，真实 PKCE/state/issuer/discovery/refresh；同 URL 双账号、追加 scopes、安全读授权后续跑、非幂等操作不重放、无人值守不等待、并发刷新/登录、退出后实际 token exchange 的迟到结果、资源变更与一次性部署回调。 |
| C 模型 | `runnerModels.integration.test.ts`：真实 MomRunner、Codemode 沙箱和真实扩展子进程，验证并行分类、多图/参考图/伴随文本、媒体来源/制品/用量、Manual/Plan、命令、流式和 Deferred、局部流取消、显式压缩。隐藏模型工具不进入真实模型请求。`nativeModelResult.test.ts` 验证公共 Pi storage 重开复用、变参拒绝、未知收费请求换 id 拒绝、并行身份；`modelOperations.test.ts` 验证制品失败保留稳定用量。 |
| D 扩展 | `executeTool.test.ts`、`modelStream.test.ts`、`modelRegistry.test.ts`、`sessionSnapshot.test.ts`、`runtimeContext.test.ts`：独立子进程、同步快照、目录/工具失败、合作取消及忽略取消终止、工具进度/局部 signal、超限 IPC、调用结束后的迟到响应拒绝。真实 Runner 命令无额外模型请求；原生压缩产生实际请求并只记一份用量。 |
| UI | `tests/ui/pi-oauth.spec.ts`：本地 OAuth 回调在 token exchange barrier 停住，切换页面后完成；即时中英切换、明暗主题、390px 宽度及隔离服务重启后授权/工具可用。Chromium/WebKit 各连续 5 次通过，无重试。 |
| 原生 App | `tests/pi/native-harness.ts` 的独立 bundle、临时数据和本地服务：冷启动 → 首次 MCP 授权经 Tauri 系统浏览器 → 页面/Session 切换 → 设置保存触发托管服务重启 → 强杀该隔离服务 → Supervisor 自动恢复；恢复后界面显示 Authorized/Connected/Loaded tools:2。测试 App 和 Provider 均已退出，用户服务未中断。 |

原生 App 观察使用真实 macOS 窗口的 accessibility 状态与隔离服务 owner/pid；布局视觉检查使用独立浏览器截图。没有将桌面缩略图当作完整像素验收。

## 检查结果

以下结果对应实际执行过的入口；仓库没有 `verify:feature`，因此按项目规则手动运行相关检查。

- 核心回归：805 项通过，1 项因缺少 `fd` 跳过，0 失败；覆盖 core/durable/tools/mcp/models/extensions/rooms/commands/usage 和 Pi recovery。
- `test:service-bootstrap`：21；`test:desktop-chat`：305；`test:projects`：86；`test:decision`：50，均通过。
- 新增后端主回归 65 项，连续 5 次通过；补充 Registry、取消费用和隔离环境检查另做 5 次。UI 两个浏览器各 5 次通过，无自动重试；窄屏断言授权信息与按钮不重叠、页面不横向溢出。
- 根 `check/build`、`desktop:check` 与桌面前端 `build` 通过；桌面检查有 1 项已有警告。根 build 使用完整临时数据路径覆盖，避免构建分析进程继承本机 dotenv 路径。
- MCP UI 守卫：4 项通过。Rust 原生测试：70 项通过。
- 初次补齐时 `desktop:test` 有一项共享规则 scope 基线失败。整体版本审查后已修复：使用已授权的 Desktop API，327 项全部通过，见[审查修复记录](review-fixes.md)。

## 故障证明与修复归类

费用在制品失败时漏记属于收据提交顺序问题，修复前回归失败；模型返回后先记录原始结果/用量，再处理制品。扩展 signal 丢失及 IPC 丢失 AsyncLocalStorage 属于异步调用归属问题；合作取消回归修复前失败。迟到 IPC 成功响应属于生命周期竞态，释放 token 的在途 barrier 回归修复前失败。显式 compact 被禁用的自动压缩 hook 吞掉属于接口接线问题，真实 Runner 用实际请求和用量拦截。桌面授权 toast 属于派生状态保存为文案的问题，改为语义 key 后即时语言切换和页面恢复回归守卫。MCP 窄屏行使用信息/动作纵向堆叠及 URL 折行，截图和不重叠断言拦截按钮挤占文本；在隔离测试页面注入旧的横向布局后，该断言准确失败，未修改产品样式做故障注入。

这些类别已有共享机器守卫；不追加重复的长期协作规则。测试 fixture 的大结果报告另按发送完成回调和进程 close 收尾，避免报告尚未冲刷就 disconnect。

## 明确边界

- 没有真实第三方账号、公网部署或付费 Provider 验收。公网 callback 路由在本地协议服务验证，尚未验证某一实际部署的反向代理/origin 配置。
- 退出/删除使本地授权失效，迟到 token 不能复活。当前 Pi 公共 OAuth API 未提供远端 token revoke；不声称远端授权服务器已撤销 token。
- 分类/图片公共返回没有 Deferred handle；chat Deferred 已接通。脚本内存不持久化，重启后的部分工作遵循现有核对及剩余工作流程。
- 服务器接口明确拒绝终端 UI、全局凭据/Provider 修改、未支持的请求选项及 compact 终端回调，不保证任意 Pi 扩展兼容。
- 本次不提交、不发布。整个工作区还包含其他任务改动，本记录不代表它们已通过验收。

## 整体审查后的最终修复验证

版本比较基准为 v2.9.63；审查发现的 5 项问题均已修复。最新核心回归 812 项通过、1 项因缺少 fd 跳过，相关 161 项连续 5 轮通过；桌面 327 项、Rust 70 项、根/桌面类型和构建均通过。共享规则的两浏览器各 5 次及真实原生 App 冷路径完成。详见[修复证据](review-fixes.md)。
