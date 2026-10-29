# 发现

外部投影丢弃 stopReason/errorMessage，内容为空的错误被过滤；本地投影有状态但把纯错误填入正文。共享 ConversationTranscript 在头像旁和正文下显示状态，用户需要独立居中系统条。

已接通外部 stopReason/errorMessage；最终系统状态由共享时间线每用户回合汇总。当前 run-summaries 按 channel/bot/chat/session/run 严格关联，最终回执可生成纯展示状态但不从 finalText 复制回复。没有最终事实时保持未知。

## Personal Agent PRD（2026-10-18）

现有 proactive-assistant-v1-spec.md 是本次需求的直接前身，原位重写可避免双份权威。身份/导航规格独立保留。能力矩阵最近核验为 2026-10-17，主动能力仍为未开始。新方案以项目交付为首个验证场景；未知进展不等于未完成，明确提醒承诺不能被模型沉默覆盖。

对抗式审查保留的边界：固定提醒不能被模型失败吞掉；未响应不自动暂停；类别退订不能通过摘要绕行；撤权后隐藏受限派生产物；Phase Three 不以既有 OAuth 协议测试冒充真实服务集成。没有代码变化或交付事实变化，不更新 features/CHANGELOG。

## Personal Agent 实施 spec（2026-10-18）

InternalEventKind 暂无 proactive-check；TaskScheduler 已支持内部事件分发。runtimeTask 工具排除 managed.by=molibot 的系统事件。PlanService.read 与项目 inspection 是来源入口。现有 durable 唤醒硬化只归执行器；本次跟进调度仍走 watched event，不能复制 durable worker。首轮搜索 shell glob 无匹配，已改为精确文件读取。

Spec 对抗审查：固定/条件性槽位独立，旧 requestId 超重放窗口拒绝；共享 outbox 当前不提供业务幂等与撤权闸门，明确列为实施范围而非复用事实。新 spec 与 PRD 分别负责技术契约和产品范围；未替代其它执行器设计。

## Pi 官方 Codemode 复用（2026-10-28）

当前依赖 Pi 1.3.0；官方提供 pi-durable/codemode，含工具发现、持久 store、执行日志与恢复。生产 PiConversationRuntime 仅注册 molibot 扩展，Codemode 使用本地 fork+IPC 封装。工作区有大量无关改动，必须保留。原工具支持宿主媒体记录和权限审批，替换必须验证这些真实路径。

官方 Codemode 可通过原生 ToolExecutionApi 适配现有 dispatcher。已验证共享完成收据与官方 journal 配合实现重开/审批续接；store 只覆盖同一次原生运行，不跨用户轮次。原固定 150ms Stop 测试依赖 worker 启动时序，已改实际工具启动屏障。首轮夹具把所有叶子改为原生派发，使审批挂起提前被测试外层接管；已恢复装配测试的原权限测试 seam，模型操作单独用真实原生叶子任务避免响应身份冲突。

## Pi Durable 官方嵌套调用（2026-10-28）

原生 api.executeTool 在隔离审查中被 toolOrigin 拦截，叶子没有执行。toolOrigin 只接受 model 形态 ToolTaskInput；原生 nested input 使用 parent/call，结果存在官方 NestedCallDoc 而非独立 assistant/toolResult entry。本地 nestedCall 自建子 conversation 和 molibot.nested-call，现应删除并适配官方身份/结果。PiDurableKernel 类仅测试与 eval 使用，生产只导入其 registry/ownership helper。

## Pi Durable 嵌套复用结果（2026-10-28）

- Pi 官方 nested task 输入是 parent/key/call，结果通过 NestedCallDoc 和 tool_execution_end.result 提供；旧适配只识别 assistant/callId 和 entry，导致身份拒绝、恢复漏检与结果投影缺失。
- 官方 executeTool 的 context 取消只取消 waiter，宿主局部期限仍需使用原生 abortTask/waitForTask 收敛叶子处理器。
- 原生规范调用 ID 改变后，流式模型回调需按原请求 callId 查 sink。隐藏内部模型使用官方 callers:tools，刷新工具时必须保留注册。
- 旧 PiDurableKernel 只被测试/fixture 使用，已删除；新 fixture 仅打开/运行/关闭正式 PiConversationRuntime 并序列化结果，不实现调度循环。
- 历史容器执行锁守卫未覆盖官方 nested task 的输入/结果结构。现有长期边界规则足够，补正式入口机器守卫，无需新增重复规则。

## 最终结果回归（2026-10-29）

工作区已引入 delivery/result/resultKind，但运行时仍以 stopReason 选择尾部消息，尚未保证工具后回复包含完整回答。transcriptRenderBlocks 无 steps 分支生成 text，而分段函数只让 result 进入回复区，存在普通消息空白路径；需复现。TurnProcess 还将所有 thinking 提到时间线顶部，且进度旁白暴露在折叠外，与最新目标不符。

已确认并复现：无 steps 的 content 被归入过程；另有 steps.result 与 content 不一致时界面展示旧结果。已新增先红后绿用例，修复为已提交 content 权威；实时未提交 token 只留过程。共享系统提示增加单一 answer-delivery section，正常工具后请求要求独立完整回答，不额外调用模型，不污染持久化上下文。原有结构测试把思考提升到时间线顶部，已按新行为调整。

最终审查补充：新消息必须显式标为 process，只有真正提交后才转 final/partial；否则审批/停止记录会被 legacy 尾段规则重新提升为答案。另修 SSE done 使用累计 token 或 threadNotes 兜底的问题；工具结果、诊断和回复提交在传输端分离。新增等待审批界面回归读回真实 Session（none），拒绝后核对 done 和磁盘未写入。首次审批测试错误地等待决策前 SSE 结束，已按实际 inline 审批生命周期修正验证点，未增加超时或重试。

## 过程时间线扁平化（2026-10-29）

原始记录与共享 steps 已按顺序提供内容；ProcessTimeline 中 thinking 分支复用 ThinkingCard，造成统一过程里面再套思考标题。目标为同轴普通思考节点，保留原始类型、顺序、单外层折叠和独立结果，不按文字相同去重不同事件。
