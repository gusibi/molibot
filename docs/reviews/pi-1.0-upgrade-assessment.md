# Pi 1.0 升级与接入评估

日期：2026-10-02。范围：Molibot 使用的 pi-ai、pi-agent-core、pi-coding-agent，从 0.84.3 升级到 1.0.0，并保留当前工作区未提交的多人房间改动。

后续范围：产品负责人已要求将 Durable、Deferred、Codemode 和 Pi 图片生成整理为 [分阶段接入 spec](../requirements/pi-capabilities-integration-spec.md)。下文“未接入”描述本次升级交付边界，四项后续计划以该 spec 为准，尚未实现。

## 已接入

| 能力 | Molibot 接入方式 |
| --- | --- |
| Pi 1.0 与新模型目录 | 三个运行时包统一为 1.0.0，独立声明 pi-telemetry；现有共享 registry 自动提供新模型、Provider 和能力元数据；聊天设置排除只有分类模型的 Provider，分类 API 仍访问完整目录。隔离服务的模型接口已返回 GPT-6.1 Sol。 |
| transcript 系统提示词与工具声明 | 自定义 Provider 请求先使用 `normalizeContext()`；Anthropic 原生 transcript 保留系统消息和动态工具更新，由 Pi 根据模型能力回放或折叠。上下文预算读取最终提示词和工具，系统文本只计算一次。 |
| 每次请求准备与回合结束钩子 | `prepareRequest` 在首次请求及后续请求前恢复当前渲染的 Bot/profile 提示词和工具；审批暂停使用 `finishTurn`，错误和取消仍直接结束。 |
| 请求思考档位 | Pi 在最终 assistant message 写入 `thinkingLevel`，现有整对象上下文存储保留该字段；回归验证实际 Agent 请求带有该记录。 |
| Sign in with ChatGPT | OAuth 登录传递持久 UUID，保存为认证目录旁的 `pi-device-id`，重新读取复用已有身份。OpenAI 登录入口来自 Pi registry。没有调用真实账号完成登录。 |
| Anthropic 复制验证码登录、Meta OAuth | 现有通用 OAuth select/text 交互承接上游登录步骤，无需新增专用设置。隔离服务的认证接口已返回相关 Provider；真实浏览器授权未执行。 |
| 统一分类模型 API | TypeSafe-compatible Jev 的 Auto 决策使用共享 `Models.classify()`，保留自定义 Host/模型、显式密钥、10 秒超时、取消、零重试、重定向拒绝和错误脱敏。原始 Choice/Score/Noul 协议诊断继续使用 SDK，以检查上游原始字段，避免 Pi 归一化丢失诊断字段。 |
| Provider 协议修复 | 更新后的上游实现直接提供缓存费用、严格工具 schema、跨 Provider 工具回放、上下文溢出和重试修复；现有 Trace telemetry 接入独立包。 |

## 尚未接入或不适用

| 能力 | 当前处理与原因 |
| --- | --- |
| `Models.generateImages()` / OpenRouter 图片模型 | 未新增产品入口。Molibot 当前图片生成走独立 Provider、任务及制品链路；新图片后端还需要模型选择、图片回传、费用与任务错误验证，不能仅加入一个未被调用的 runtime 方法就算交付。 |
| Pi Durable / deferred provider response | 未切换。独立的 pi-durable 会话和持久任务系统会改变现有 Session、任务、恢复和取消架构；保留已有 Molibot durable 实现。 |
| Codemode / Pi MCP 管理与 OAuth | 未替换 Molibot 自有工具执行和 MCP 管理。直接开启另一套工具系统会影响权限、审批、工具展示和进程隔离。子 Agent 与现有 pi 扩展接入仍保留。 |
| 全屏 TUI、终端主题、CLI 登录 Radius 后配置 MCP | 不属于 Molibot Web/Desktop 界面；没有复制上游 CLI 专属界面。 |
| `onProviderStreamEvent` 原始事件 | 未持久化原始 Provider 事件。现有标准流式事件和 Trace 已覆盖产品需求；原始事件可能包含提示词、工具参数或敏感响应，需要另行确定采集与脱敏范围。 |
| 额外分类 Provider 和 llama.cpp classifier | 本次没有新增决策设置选项。现有 Jev 接入可继续配置 TypeSafe-compatible 服务；本地概率分类需要独立的服务与模型验证。 |
| assistant-message frames、轻量 models 入口 | 未替换现有消息存储；当前 runtime 使用完整内置目录，单纯换轻量入口没有明显收益。 |

除上述四项后续 spec 外，其他未接入项没有批准排期；本次升级和后续 spec 不改变个人助理能力矩阵的交付状态。

## 验证与限制

- 255 项相关回归通过，覆盖 Provider、认证、主循环、审批暂停、压缩、模型路由、Jev 分类、durable preflight、子 Agent 与扩展；全部使用临时数据目录或注入凭据。新增守卫覆盖 session 重载后的真实系统提示词/工具、原生 transcript 工具更新、思考档位和 OAuth UUID。
- 冻结锁文件安装和生产构建通过。Desktop `svelte-check` 为 0 错误、1 个既有界面警告。
- 隔离服务冷启动及同一数据目录重启后的深度健康检查通过；OAuth 与模型目录接口可用。没有重启或中断用户服务。
- 全仓 `tsc --noEmit` 未通过：310 个错误，涉及 QQ 插件缺失类型、其它业务/测试类型等；本次修改的运行时代码没有剩余类型错误。未修复这些范围外问题。
- 全仓 `git diff --check` 报告现有多人房间需求文档末尾多余空行；本次新增和修改文件的针对性 diff 检查通过，未清理用户已有内容。
- 未验证真实付费模型请求、真实账号授权、原生 Desktop 登录交互和 OpenRouter 图片生成。

## 迁移守卫

本次风险属于上游 API 和运行生命周期变化。此前使用替身 stream 的测试没有检查真正发送的系统提示词和工具，无法拦住 transcript 迁移丢字段；新增实际 Agent 请求回归补上这一缺口，分类回归同时约束 429 不重试、禁止重定向和错误脱敏。现有提示词真实渲染、临时数据验证规则已覆盖该类维护要求，不再向长期规则追加单次升级记录。

## 来源

- [pi-agent-core 1.0.0 changelog](https://github.com/earendil-works/pi/blob/v1.0.0/packages/agent/CHANGELOG.md)
- [pi-ai 1.0.0 changelog](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/CHANGELOG.md)
- [pi-coding-agent 1.0.0 changelog](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/CHANGELOG.md)
- [此前升级评估](pi-mono-upgrade-assessment.md)
