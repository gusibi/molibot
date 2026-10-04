# Pi Durable 第一阶段验证记录

日期：2026-10-02。范围：执行适配与恢复安全守卫；阶段 1 仍在实施，未切换正式 Runner。

## 已实现与验证

- 固定 `pi-durable` 与 `chord` 为 1.0.0，使用上游 Harness、ToolTask 和 Node SQLite，未重写第三方 checkpoint 或加入旧执行格式 fallback。
- 一个存储文件绑定 owner、execution、step、plan version、授权标识、模型端点、请求和工具契约。改变绑定拒绝重开；相同请求重开复用提交和已完成结果。
- 工具默认 unsafe，只有工具契约显式声明 safe 才允许重放。持久化 execute checkpoint 的未知 unsafe 操作在启动模型前阻断，返回待人工核对状态。
- 宿主审批先持久化，再挂起 Pi 的 beforeTool；重开后消费业务审批并继续同一调用。共享 Durable Runtime 的隔离装配验证了审批、intent/receipt 和目标验收仍由 Molibot 管理；等待审批后关闭并新建业务 store，再重开 Pi 存储继续调用。
- 真实子进程经本地 OpenAI-compatible HTTP 模拟器执行。分别在外部发送后尚未提交结果、发送结果已提交后强杀。重启使用同一数据库，独立外部 ledger 确认发送只有一次；未知副作用场景不再请求模型。
- Stop 传播给活动工具，迟到成功不提交；同存储并发打开被拒绝。宿主仍须提供真实服务租约和权限检查。
- 现有共享恢复路径检查全部步骤 intent，修复此前只看最后一条的缺口。仅查询某个外部操作不能证明整个多操作步骤完成。

## 检查结果

- 最终 Durable 定向回归：23/23，包括两种真实 SIGKILL 场景。
- 根目录 TypeScript 与生产构建通过。Desktop Svelte：0 错误、1 条既有警告；Web Svelte：87 条既有页面/依赖声明错误，没有本次 Durable 文件诊断。
- 一次隔离全量运行：2365 项，2359 通过、5 失败、1 跳过。工具路径测试假设默认数据目录；Mini App 子进程环境与临时 DATA_DIR 冲突；渠道所有权测试与全局禁用外部渠道开关冲突；Desktop 审批夹具已超过过期窗口；MCP 界面断言与当前组件代码不一致。这些失败不涉及本次修改文件，未改动相关功能。
- 独立 Standards/Spec 审查 agent 因账号额度限制未能启动审查。已自行检查资源释放、取消、存储绑定、审批前 intent 顺序及验收边界；独立审查仍缺失。

## 正式接线准备（2026-10-03）

共享 ToolRuntime 提供先授权、后执行的单次 invocation：授权固定参数快照，执行前及取得写槽后检查取消与权限，异步 intent 回调返回后再次检查取消。Pi 正式 Harness 的隔离测试验证 Broker 等待不提交工具 intent（checkpoint 保持 `call`），批准后提交一次 intent/receipt，已完成结果重开复用。显式 Host Bash 审批已迁入共享准备边界：实际 HostBashStore 与 Harness 重开验证批准前没有 intent、批准后只启动一次原命令。自动 sandbox 升级与外部审批执行入口仍未迁入，不能声称所有审批已接线。

本轮关联回归 55 项全部通过，包括两种真实子进程强杀恢复；类型检查和生产构建通过。全量 3187 项中 3178 通过、7 失败、2 跳过，失败为其他模块现有夹具/模块加载及外部渠道禁用条件；没有全量全绿结论。双轴审查发现的排队期间停止/撤权窗口已修复，有持槽 barrier 回归守卫。

[ADR 0005](../adr/0005-pi-durable-private-execution-storage.md) 的限定存储边界已接受。正式 Runner 没有切换；阶段 1/2 不能标为完成。剩余工作包括自动 Host Bash 升级与外部审批执行归属、正式模型/工具循环替换、模型流式输出映射、队列恢复唯一负责人、预算与前台子 Agent 恢复，以及正式入口故障窗口验收。

## 提交记录投影与异步恢复（2026-10-03）

内核在每次打开时重建已提交记录投影，并订阅 Pi 的 committed event stream；observer 溢出后的 snapshot 也按提交来源处理。关闭 observer 并等待其回调结束后执行最终全量校对，避免实时和最终写入并发。Session 按执行绑定和 entry ID 的稳定来源去重；同一来源的内容或 run 归属改变时拒绝覆盖。投影失败后关闭内核，重开可补齐记录，不把投影失败等同于工具执行失败。

初始上下文作为不可变历史参与绑定；每请求临时控制通过正式 GenerationTask.beforeRequest 注入，不写入 Pi entries。结果包含已提交的原始模型记录，保留错误/中止状态供宿主判断。审批等待返回后再次检查授权和取消；活动执行期间定期检查服务租约，丢失时中止所属工作。

真实子进程在 Pi 已提交 Deferred poll checkpoint、进入 fetchDeferred 后被 SIGKILL。同库重开查询原 `remote-job-42`；再次重开复用答案。独立 ledger 显示一次提交、两次查询，答案及 usage 只有一份。该证据使用本地 fixture Provider，不代表正式 Provider 或产品入口接线完成。

关联回归 62/62 通过，根目录类型检查和生产构建通过。最终全量为 3195 项：3189 通过、4 失败、2 跳过。失败涉及 Desktop composer 模块加载、Provider 图标、Broker 审批过期夹具及 MCP 设置静态断言，未修改这些无关模块。Standards/Spec 双轴独立审查未发现本轮增量的必修问题，均指出正式入口仍未接线。所有数据库、工作区和外部 ledger 都位于临时目录；没有调用付费模型或重启用户服务。

## 进入正式接线前的差距

当前适配器仅被隔离测试装配调用，正式 Chat/自动化/Channel Runner 仍使用现有内核。共享 Runtime 测试不是正式 HTTP 入口验收；审批等待测试重开业务数据库与 Harness，没有替代完整服务重启验证。阶段 1 不标为完成。

正式装配需要把现有 Broker 与 Host Bash 审批都放到 Pi intent 之前，接入运行预算、服务租约丢失时的取消、流式投影、工具结果与业务证据的重建，以及不可重放操作的人工处理。两套 SQLite 之间没有原子事务；恢复必须以 Pi 的提交结果重建业务投影，不能把业务 receipt 当成 Pi 提交证明。

Pi 的任务状态在原生 SQLite 中存储，checkpoint 属于 ADR 0005 允许的第三方内核私有执行记录。Molibot 的目标、计划、审批、owner、版本和租约继续遵循 ADR 0004 的列式状态与共享写入边界。

阶段 2 的统一内核切换、阶段 3 的 Deferred 持久等待、阶段 4A 的 Codemode、阶段 4B 的图片后端均未在本 slice 实现。

## 修复沉淀

本次恢复缺口属于恢复范围判断错误：旧守卫只检查最后一次调用，却重跑整个步骤。已有 queryable 守卫无法拦住更早的危险 intent。非幂等/queryable 后接安全调用的回归覆盖该类问题；长期跨渠道副作用规则已存在，不再向 AGENTS.md 重复追加单次修复记录。

## Host Bash 准备边界（2026-10-03）

工具注册与 standalone Bash 共用准备接口；参数、执行上下文与审批归属固定，批准仅产生待执行 invocation，实际执行时重新校验权限并原子认领。稳定工具调用身份复用同一审批，命令变化拒绝复用；按 ID 批准也校验 scope/Session。停止、撤权或取消未执行 invocation 不启动进程；取消会过期尚未执行的审批。准备清理失败仍尝试其余清理并关闭 Harness，真实同路径重开回归通过。

共享工具与审批回归 109 项、Runner/审批挂起/Desktop/内核关联回归 67 项、外部审批分发回归 3 项通过；审批身份补充回归 27 项及清理失败回归 1 项通过。类型检查与生产构建通过。隔离数据目录的全仓测试为 3202 项：3193 通过、7 失败、2 跳过。失败位于 Desktop composer 模块解析、Azure logo 断言、Python 数据目录、Mini App 子进程、过期审批 fixture、禁用外部渠道后的 ownership 断言及 Desktop MCP 静态断言；全仓检查未通过。

正式 Runner 仍由现有 Agent 驱动。sandbox 失败后自动升级的执行与 out-of-band 批准后的进程启动仍需统一进入 Pi；当前实现没有提前删除这些可用路径，也没有把它们算作替换完成。

## 审批回调中的停止（2026-10-03）

真实临时 HostBashStore 回归先复现了两个窗口：消费 Durable 审批期间停止、发布审批通知期间批准并停止。共享准备函数现在在异步回调返回后检查取消，将 pending/approved 的未执行审批过期，不返回可恢复等待，也不认领进程。晚到批准无法重新激活同一请求。Bash 审批回归 10 项通过；这是现有审批流程的取消守卫，正式 Runner 切换状态不变。

## Pi 原生事件输出（2026-10-03）

内核输出 Pi 原生快照与实时事件，先完成提交记录投影，再向显示消费者交付事件。已提交工具结束事件带实际 entry；重开以快照重建，不重新发出旧工具启动事件。显示消费者失败会终止观察并关闭 Harness；重开复用已提交结果，不重复副作用。

原生事件、Durable Runtime 与 Session 关联回归 33 项通过，类型检查通过。该事件边界尚未接入正式 Runner 的现有流式展示消费者；正式任务入口、稳定执行身份与输入快照仍需一起装配，不据此标记阶段 1 完成。


## 持久预算与原始入站恢复（2026-10-03）

Pi 重开现在可按原 requestId 恢复已接纳的输入、指令与初始历史，不使用新 Attempt 生成的 briefing；恢复仍校验当前模型、端点、工具和授权绑定。延迟读取 admission 的回归验证：绑定校验完成前，待恢复工具不准备、不执行。

正式 Runner 已将工具次数、失败次数和模型尝试次数写入私有运行目录的结构化预算库；Durable 的同一步骤跨 Attempt/审批恢复使用稳定预算身份，原始上限保持不变。工具收据身份包含完整原始 assistant 消息与 callId，避免 Provider 跨回合复用 ID 时漏计；未知工具与参数校验失败同样分别计入失败预算。父子任务共享预算、执行总费用和正式 Pi task 预算接线仍未完成。

用量账本支持按响应记录身份持久去重；相同响应恢复重放只计一次，归属或用量冲突报错。Runner 使用已保存的 assistant entry 身份；未来 Pi 正式投影必须传入稳定来源，再使用返回的 Session entry 身份记账。这不是正式 Pi 恢复计费完成的证据。

Runner、审批挂起、预算、共享 Durable Runtime 和用量关联回归 74/74 通过；Pi 内核回归 21/21 通过，含隔离 localhost 假 Provider 与真实 SIGKILL。类型检查与生产构建通过。Runner 测试工作区已改为临时目录，避免固定运行身份读取前次测试的预算。正式 Runner 模型/工具循环仍未切换。


本轮 `src` 全量检查共 2367 项：2358 通过、8 失败、1 跳过。其中 5 项为并发测试共用临时审批库引发的 SQLite 锁冲突；涉及的命令与 Turn Orchestrator 文件串行复查 53/53 通过。另 3 项位于已记录的 Python tooling 路径、Mini App 子进程及 Desktop Broker 过期审批夹具。全量检查没有通过；未改动这些无关产品模块。生产构建通过。


## 原生会话与自动 Host Bash 阶段收据（2026-10-04）

`PiConversationRuntime` 持有正式 Harness/Conversation 生命周期；`PiRunSession` 提供现有上层需要的状态和事件视图，不运行旧 Agent loop。原生 continuation 不制造新 UserEntry；动态工具配置限制在授权 registry 内。输入、projection run 身份和提交来源在重开时保持原值。初始化期间 Stop 与 close/reopen 回归通过；观察回调串行，取消准备资源后关闭存储。

自动 Host Bash 的 sandbox 尝试采用原 ToolTask memo 中的 intent/receipt；沙箱输出、artifact 移动和压缩后的结果一并保存，重开复用收据。权限失败在 native preparation 返回原 Host 请求；等待时 ToolTask 不提交主机 execute intent。批准后执行原调用，拒绝后只提交拒绝结果；未知阶段结果保持原任务并阻止下一次模型请求。真实临时 HostBashStore 与原生会话的新建/关闭/重开测试验证三种路径。主机操作在 native execute 开始后中断仍按 unsafe 规则要求核对，不保证未知外部操作可自动恢复。

工具回调从 native Task input 的 assistant entry 解析来源，Provider 跨回合复用 call ID 不混淆预算来源；afterTool override 写入原生收据。第三方 details 即使包含私有 envelope 同名字段也不能伪造审批 metadata。Deferred 查询和取消复用原 handle，并保留 run 凭据、Session affinity 请求头与当前回调，隔离 Provider 夹具验证完成和 Stop 两条路径。

验证：Runner/审批/原生会话/工具定向回归 102/102，Pi 内核 21/21（含 localhost 模拟 Provider 与真实 SIGKILL）；随后补充 Deferred adapter 回归 5/5，最终原生生命周期/Deferred/收据回归 13/13。最终生产构建（包含 TypeScript 检查）通过；一次源码全量 2378 项：2374 通过、3 失败、1 跳过。失败仍在 Python tooling 临时路径、Mini App 子进程与 Desktop Broker 过期审批夹具；全量检查未通过。独立 standards review agent 因账号额度不能执行，完成了本轮自主对抗式检查。

**当前生产状态：** 正式 Runner 仍使用原 Agent，外部审批入口仍有 out-of-band 执行。曾尝试的默认切换已撤回，原因是内部子 Agent 与混合审批恢复尚未完成；没有交付第二套生产开关或 fallback。原生子 Agent 的 ownership/预算/取消，以及生产 Deferred 等待投影和一次记账仍需接线。以上隔离结果不能标记阶段 1/2/3 完成。

## 混合工具批次审批挂起（2026-10-04）

隔离回归复现了两条授权路径的异步竞态：原生准备流程或 `beforeTool` hook 挂起审批时，同批后续写入仍已执行。旧 Runner 的批次预检与审批 barrier 没有覆盖新原生会话，因此已有 Runner 守卫不能拦截此路径。

共享 Pi registry 现在对带授权 hook 或准备流程的工具使用原生 `sequential` 模式；Pi 将整个批次串行调度，后续 ToolTask 仅在前一任务终结后创建。此选择也会串行这些工具不需要审批的批次。没有授权 hook、准备流程的工具仍保留其声明的执行模式。没有增加 Channel 特判或重放策略。

三个新增回归覆盖普通 `parallel` 工具与审批工具混用、两种挂起来源，以及 `PiRunSession` 的关闭与重开。等待期间只保留读取结果；恢复收到原审批 ID，三次操作各执行一次，保留原入站内容且仅有一条用户消息。原生内核/会话/adapter 定向回归 34/34 通过；补充 adapter 回归 6/6、最终混合批次回归 3/3 通过。类型检查、生产构建与增量 diff 空白检查通过；独立 Standards/Spec 审查未发现本轮必修问题。

一次隔离串行源码全量共 2382 项：2378 通过、3 失败、1 跳过，未全绿。失败为 `python tooling defaults to data-dir tooling/python`、`miniAppManage contains a candidate process exit during validation` 和 `Desktop lists Broker tool approvals only for the requested session`，与前次记录相同；未修改这些模块。所有持久化检查使用临时 DATA_DIR；没有重启用户服务或调用付费模型。

正式 Runner、外部审批执行归属、内部子 Agent 与完整生产 Deferred 接线仍未完成。本次只关闭混合批次的原生挂起缺口，不关闭阶段 1/2/3。
