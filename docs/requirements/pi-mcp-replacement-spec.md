# Pi MCP 接入替换规格

2026-10-11 后续范围：客户端替换保持已实施状态。本规格排除的 OAuth 登录现由 [Pi 能力补齐规格](pi-capability-completion-spec.md) 单元 B 承接；其他范围和已实施约束保持有效。

日期：2026-10-10。状态：已实施（2026-10-11），验证证据见文末。优先级：未指定。

## Problem Statement

Molibot 当前直接使用官方 MCP SDK，自行管理连接、发现工具、转换结果，再交给共享 Runner 执行。项目已使用 Pi 1.0.0，且其 Coding Agent 依赖中已有独立的 `@earendil-works/pi-mcp`。继续维护重复的底层能力增加升级与排错成本。

用户希望复用 Pi 已提供的 MCP 实现，删除被替代的代码，同时保持现有 MCP 设置、会话选择、工具调用、审批、停止及恢复行为。

## Solution

采用 Pi 的独立 MCP 客户端和 stdio、Streamable HTTP transport，替换 Molibot 的官方 SDK 客户端接入与重复的内容转换。连接后的工具继续通过共享 Runner 和 ToolRuntime 执行。

Molibot 只保留产品所需的配置映射、连接状态投影、会话访问范围、权限审批、输出限额与持久执行关联。设置仍由 Molibot 管理，用户无需维护另一份 Pi MCP 配置。

本次使用 Pi 的 MCP 实现，但不启用 Coding Agent 的 `createMcpExtension()`：该扩展依赖其资源加载与会话生命周期，直接采用会扩大为会话架构替换。独立 `pi-mcp` 是 Pi 明确提供的客户端入口；保留薄工具适配符合其公开用法。

## User Stories

1. 作为用户，我希望 MCP 底层使用 Pi 维护的实现，以便减少重复维护。
2. 作为用户，我希望现有 stdio 服务器继续可用，以便无需重配本地工具。
3. 作为用户，我希望现有 HTTP 服务器继续可用，以便继续访问远程服务。
4. 作为用户，我希望命令、参数、环境变量、工作目录和请求头保持有效，以便配置行为不变。
5. 作为用户，我希望启用和禁用设置继续生效，以便控制哪些服务可访问。
6. 作为用户，我希望连接状态和错误信息真实反映服务器情况，以便排查连接失败。
7. 作为用户，我希望按会话加载和卸载服务器，以便工具仅在选定会话中可用。
8. 作为用户，我希望列出和调用已加载工具，以便完成现有工作流程。
9. 作为用户，我希望保留工具命名和自定义前缀，以便现有技能仍能准确选择工具。
10. 作为用户，我希望工具参数 schema 完整传给模型，以便参数正确。
11. 作为用户，我希望文本、图片及结构化结果可被模型理解，以便工具结果不丢失。
12. 作为用户，我希望 MCP 工具失败被明确标记，以便失败不会被当作成功。
13. 作为用户，我希望大结果继续受限并保留完整输出制品，以便避免挤满上下文。
14. 作为用户，我希望敏感请求头和环境变量不出现在诊断中，以便凭据不泄露。
15. 作为用户，我希望第三方工具继续遵守当前权限模式，以便底层替换不放宽权限。
16. 作为用户，我希望直接调用、mcpInvoke 和 Codemode 内嵌调用使用同一审批入口，以便没有绕过审批的路径。
17. 作为用户，我希望批准后恢复原有调用，以便无需重新提交任务。
18. 作为用户，我希望拒绝或撤销审批阻止尚未执行的调用，以便控制外部副作用。
19. 作为用户，我希望停止和超时结束本地等待，以便失联服务器不会长期卡住任务。
20. 作为用户，我希望未知的外部写入结果不会自动重放，以便避免重复操作。
21. 作为用户，我希望断线后可显式重连，以便恢复服务器访问。
22. 作为用户，我希望工作区、owner 和会话之间保持访问隔离，以便不会调用别人的服务器或凭据。
23. 作为用户，我希望服务关闭时释放 MCP 子进程和网络连接，以便不留下后台资源。
24. 作为维护者，我希望只有一套生产 MCP 底层接入，以便排错和升级有明确入口。

## Implementation Decisions

- 显式声明 `@earendil-works/pi-mcp` 为直接依赖，与当前 Pi 1.0.0 系列对齐，不依赖传递依赖偶然可见。
- 使用公开 `McpClient`、`StdioTransport`、`StreamableHttpTransport`、`toLlmContent`；不引用第三方私有实现，不自写 JSON-RPC、请求关联、分页、取消协议或传输重连。
- 设置存储、API 和页面保留现有契约；不新增配置文件、配置层、migration 或旧实现 fallback。配置映射只在共享接入边界进行。
- 保留 `loadMcp`、`mcpInvoke` 和当前工具命名契约。这些属于 Molibot 的会话工具入口，不是 MCP 协议实现；工具执行必须通过共享 ToolRuntime。
- 生产直接使用 Pi 客户端，不维护并行的官方 SDK 接入。官方 SDK 若仍被测试服务器或其他独立模块使用，可仅为对应用途保留；先清点全部引用再调整依赖。
- Molibot 保留需要的连接注册表与状态投影。沿用现有作用域，并验证它不会在不同 owner、工作区或会话之间扩大访问；卸载一个会话不得关闭另一会话仍在使用的连接。
- 连接失败、transport 关闭和重连必须同步清除失效工具。重复加载不得累积连接或工具，配置变化不得复用旧凭据连接。
- 使用 Pi 内容转换替代重复解析；保留结果限额、完整输出落盘和错误脱敏。保留 `isError`、工具注解及运行关联所需的 server/tool 身份，不把协议错误或工具错误包装为成功文本。
- 分别核对文本、图片、内嵌资源、资源链接、音频和只有 structuredContent 的结果。遵循 Pi 的公开转换语义；不承诺新增音频或资源浏览功能。
- 保持连接 8 秒、工具执行 120 秒的现有限额。优先用 Pi 的请求超时和 AbortSignal；若 progress 续期会突破总限额，只保留统一的绝对截止控制，不复制协议取消实现。审批等待继续由共享运行时管理，不计入实际远程执行等待。
- 本地取消与远程副作用完成是不同事实。超时、断线或停止后，无法证明结果的写入不得自动重试；沿用现有未知结果和审批恢复约束。
- MCP annotations 必须进入现有权限分类。未声明的注解不得推导为只读；切换底层不得改变各权限模式的既定规则。
- 普通调用、mcpInvoke 与 Codemode 使用一致的工具身份和审批/取消链。持久恢复必须核对已准入的服务器配置及调用参数，配置改变后不得使用旧审批执行。
- Channel 只负责收发与适配，不增加任何 MCP 接入、审批或恢复分支。
- 若实现涉及 prompt 或工具发现，检查真实最终系统提示词：工具入口可用、无重复 section、没有把动态工具 schema 塞入稳定缓存前缀。
- 删除被 Pi 替代的客户端构造、transport 事件接线和内容解析；保留每项产品适配的明确用途。完成后逐项检查是否仍有重复底层能力。

## Testing Decisions

测试外部可观察行为，不断言内部调用次数或源码结构来证明接入正确。主验收边界采用现有共享 Runner，使用脚本模型、真实 Pi 客户端和隔离 MCP 测试服务器；该边界已由用户确认。

- 复用现有审批 suspend/resume 测试模式，以模型可见结果、审批记录、运行状态和服务器副作用计数作为证据。
- 主入口覆盖：加载 → 发现 → 调用 → 返回结果；禁用/未加载拒绝；卸载后不可调用；重复加载；会话切换；不同 owner/工作区隔离。
- 同一权限场景覆盖直接调用、mcpInvoke 和 Codemode，确保嵌套调用不绕过审批。分别验证批准只执行一次、拒绝不执行、等待期间停止不复活。
- 用现有持久执行测试边界验证 suspend/reopen、配置改变后的拒绝、已提交结果不重放以及未知写入结果阻断。不得为测试另建执行恢复机制。
- 少量客户端边界测试连接真实隔离 stdio/HTTP 服务器，覆盖参数及凭据映射、分页发现、错误返回、断线、显式重连、取消、绝对超时和子进程释放。用可观察结果证明生产路径经过 Pi 实现。
- 结果转换覆盖文本、图片、内嵌资源、structuredContent、isError、大输出及错误脱敏；只检验 Molibot 承诺的呈现结果，不重复测试 Pi 全部协议内部。
- 持久化与 settings 检查使用临时数据库、临时数据目录和临时工作区。若变更任何 settings 字段，增加 save → fresh store → load 的整对象 round-trip。
- 运行相关现有 MCP、权限分类、工具调度、审批恢复、Codemode 和 Desktop MCP 契约检查，以及类型检查和构建。现有失败与本次新增失败分别记录，不以旧失败免除新增问题。
- 在隔离服务走冷路径：重启服务 → 首次打开 MCP 面板并调用 → 切换 Session/页面 → 服务中断恢复。若改动页面，额外完成 svelte-check、中英即时切换、明暗主题和移动宽度检查，遵循现有设计规范。
- 交付前检查权限绕过、跨作用域连接复用、失效工具残留、重复副作用与是否有更简单实现。真实用户服务器未验证时明确记录，不声称覆盖所有外部服务。

## Out of Scope

- 替换整个 Runner、Coding Agent 会话或 Durable 内核。
- 重做设置页面、Channel、Mini App、OpenConnector 目录及凭据管理。
- 新增 OAuth 登录、MCP resources/prompts 产品入口、旧 SSE transport、sampling 或 MCP tasks。
- 更改工具调用产品交互、增加新的权限模式、自动重试未知写入。
- 操作真实用户数据、重启正在使用的服务、发布版本或部署。
- 永久双实现、兼容层、自动数据迁移或源码 vendoring。

## Further Notes

- 现状依据：已安装 Pi 1.0.0 的独立 MCP 客户端说明及公开类型、Coding Agent MCP 扩展示例，以及当前共享 Runner、连接注册表、工具调度和审批恢复测试。能力存在已确认；替换后的行为尚未验证。
- 既有 Pi 能力接入规格仍负责 Durable、Deferred、Codemode 等范围；其“不替换 MCP 管理”边界保持有效。本规格单独授权 MCP 底层替换，不将其它待交付能力纳入本次工作。
- OpenConnector 的配置、状态和审批要求继续有效；本规格只替换其底层 MCP 客户端，不取代连接器产品契约。
- 遵守已接受 ADR 的业务存储、进程隔离和第三方执行存储边界；采用 Pi 客户端不改变业务状态所有权。
- 完成标准：上述适用行为通过、生产使用 Pi MCP 公共入口、被替代的底层实现删除、验证限制明确记录，并更新已交付事实。当前仅编写规格，不标记功能已交付。
- 规格已发布到 [GitHub Issue #63](https://github.com/gusibi/molibot/issues/63)，使用 `ready-for-agent` 标签。实现结果和检查证据随后回填 Issue 及项目实施记录。

## Implementation Result（2026-10-11）

- 生产接入：`src/lib/server/agent/tools/mcp.ts` 现使用 `@earendil-works/pi-mcp` 的 `McpClient`、`StdioTransport`、`StreamableHttpTransport` 与 `toLlmContent`；已删除官方 SDK 客户端构造、transport 事件接线与逐类型内容解析。`@earendil-works/pi-mcp` 为直接依赖，官方 `@modelcontextprotocol/sdk` 仅作为隔离测试服务器依赖保留在 devDependencies。
- 行为契约：工具命名（`mcp__<prefix>__<tool>`）、`loadMcp`/`mcpInvoke`、连接注册表与状态投影、8 秒连接上限、120 秒绝对执行期限、结果限额与完整输出落盘、凭据脱敏、`isError` 与 server/tool 运行身份均保留。MCP annotations 经工具 classification 进入 `third_party` 分类，未声明注解为 `undeclared`。
- 证据：`mcp.test.ts` 20 项通过（隔离 stdio 生命周期/重连/禁用启用/错误/显式 reconnect、忽略取消下的绝对期限、参数与 `Authorization` 头部映射、文本/图片/内嵌资源/资源链接/音频/仅 structuredContent 转换、`isError` 抛出、大输出截断与落盘、注解→分类）；相关 `mcpInvoke`/`loadMcp`/`toolClassification`/`decidePermission`/`toolPermissionGate`/`codemode.integration`/`approvalBroker`/`desktopMcp`/`prompt`/`index`/`toolRuntime`/`approvalSuspension`/`runner` 回归 243 项通过；`pnpm check`、`pnpm build` 通过。
- 限制：未对真实用户 MCP 服务器或返回多页工具列表的服务器单独走查（分页由 Pi `listTools` 内部完成）；未在原生 Desktop 冷路径与真实服务重启下验证。
