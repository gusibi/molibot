# Personal Agent Phase One 实施 Spec：授权跟进、证据检查与下一步材料

> 版本：v0.1 · 2026-10-18
>
> 状态：Draft，待实施评审。本次只生成规格，不实施代码、不接真实账号。
>
> 产品依据：[授权事项的持续跟进与交付 PRD](../../requirements/proactive-assistant-v1-spec.md)。产品目标与阶段范围由 PRD 管理，本文负责实现契约。
>
> 当前实现状态：[能力矩阵](../../requirements/personal-assistant-capability-matrix.md)。本文出现的新模块、接口、数据表均为拟新增。

## 1. 范围与完成定义

Phase One 交付一个内部项目事项的完整闭环：对话委托 → 持久授权 → 检查指定 Plan/执行结果与文本文件 → 准备可查看的下一步材料 → 单一授权目标通知 → 用户更新状态 → 停止或继续。

首个验收场景：指定项目中的方案交付，检查关联 Plan 和指定 Markdown/TXT 草稿，识别明确列出的必需章节是否缺失，生成独立缺口清单或草稿，并在约定时间核对进度。不能用纯定时催促代替材料准备验收。

不包含：任意文件格式自动提取、扫描全部项目、外部日历/邮件、自动修改原文件、自动更改 Plan、隐式偏好学习、类别学习、每日汇总、长期 Goal 和大型自治执行。Phase Two/Three 的边界见第 12 节。

## 2. 代码接缝与复用裁定

| 接缝 | 当前事实 | 本次拟改动 |
| --- | --- | --- |
| `agent/events.ts` | `InternalEventKind` 没有主动检查，内部事件已有类型与租约 | 增加 `proactive-check` 和只含稳定标识的事件 payload |
| `agent/taskScheduler.ts`、`app/runtime.ts` | 已分发内部事件；`runtimeTask` 工具排除系统管理事件 | 装配跟进服务及事件处理，不走普通聊天 Session |
| `agent/plans/service.ts` | `PlanService.read(ownerId, planId)` 提供计划与步骤视图 | 适配只读证据；另验项目/Agent 授权，不能只靠 owner 相同 |
| `projects/inspection.ts` | 有 `resolveProjectPath`、`readProjectFile` | 复用路径/符号链接检查，增加本功能的文件数与输入上限 |
| `channels/shared/outbox.ts` | `SqliteOutbox.enqueue` 每次插入，无调用方幂等键和业务撤销校验 | 扩展共享投递契约；不能假定重复 enqueue 已被现有队列去重 |
| `agent/interactions/` | 有共享动作、token 绑定和提示存储 | 添加事项动作；过期或重启失效时明确反馈，不执行陈旧动作 |
| `infra/db/storage.ts` | 按业务域区分 SQLite | 增加跟进域存储路径，按 [ADR 0004](../../adr/0004-per-domain-databases-and-state-representation.md) 管理 |

以上是 2026-10-18 工作区的定向检查结果，不代表这些入口已支持跟进。既有 Durable 唤醒队列由执行器拥有，跟进检查不另建 Durable worker，也不改其调度方式。

拟新增共享目录 `src/lib/server/agent/followUps/`：`types.ts`、`store.ts`、`service.ts`、`evidence.ts`、`decision.ts`、`events.ts`。职责分别为契约、事务、应用动作、来源读取、受限判断、事件投影与恢复；通知使用共享层适配，不在渠道写状态机。不为不同来源创建插件平台。

## 3. 领域契约

### 3.1 委托 FollowUp

```ts
type FollowUpStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'expired';
type MissingEvidencePolicy = 'wait' | 'ask_at_check' | 'notify_unavailable';
type EvidenceStatus = 'available' | 'unchanged' | 'unavailable' | 'revoked';
type DecisionAction = 'silent' | 'notify';
type SourceRef =
  | { kind: 'plan'; planId: string }
  | { kind: 'execution'; executionId: string }
  | { kind: 'project_file'; relativePath: string };
```

每个事项属于一个稳定 `ownerId + agentId + projectId`；Agent 不使用 Session 临时身份。`sourceSessionId/sourceMessageId` 仅为授权追溯，不允许默认读取整个 Session。

创建输入必须包含：标题、预期结果、用户确认的完成标准、来源清单、允许的帮助（清单/独立草稿）、检查周期或下一次检查、可选固定核对时间、来源不可用策略、有效期、IANA 时区、明确选择的通知目标。时间存 UTC，展示和每日额度按事项时区；模糊日期先澄清。

同一项不同时支持多通知目标；目标为 Desktop 或一个已验证的私聊绑定。创建/更换目标时验证 owner、实例及聊天类型，不能把工作群当私聊。首次启用不自动选择绑定。

创建请求带 `requestId`，重放相同请求返回原事项；同 requestId 不同 payload 返回冲突。请求绑定可信创建时间，幂等重放窗口为 30 天；窗口外拒绝旧授权请求，须发起新的明确委托，不能因墓碑清理复活旧事项。两个独立指令即使标题相同也不擅自合并；返回已存在的相似事项供用户选择。

### 3.2 授权与版本

委托保存 `authorizedAt`、真实用户/交互来源、授权摘要版本、来源白名单、允许帮助和 `authorizationRevision`。不信任模型传入的 `authorized: true`；共享服务须绑定可信入站用户指令或已确认快照。跨轮“好的”仅能确认当前未过期的同一候选摘要。

所有写入带 `expectedVersion`；变更来源、范围、通知目标或有效期需要新的明确授权并递增 `authorizationRevision`。延后、暂停、恢复等普通控制递增事项 `version`，不无故要求重签全部委托。

检查开始捕获事项版本、授权版本与策略版本；提交判断/材料、投递和展示材料时重新校验。撤权后不能靠旧快照继续发布。

### 3.3 证据、判断、派生产物

- 证据记录来源标识、读取时间、来源版本/内容 hash、状态、受限摘要引用；`unavailable` 携带结构化错误码。无新 hash 与读取失败不能混用。
- 判断记录 triggerSlot、输入证据指纹、授权/策略/模型版本、行动、理由码、成本及关联产物。相同事项、授权版本和触发槽位只有一个有效判断；同一证据指纹不重复产生条件性建议。来源状态/错误码参与指纹，读取失败后恢复可产生新的有效判断。
- 产物记录安全 ID、相对路径、内容 hash、证据引用、事项/授权版本与有效性。内容放本功能私有派生目录，不写原项目文件、不直接加入可绕过权限的公共 Artifact 链接。
- Plan/execution 被删除时返回来源不可用；跨库引用无外键，不能因此崩溃或自动判定事项失败。

## 4. 持久化与原子边界

新增 `<dbDir>/follow-ups.sqlite`，store 可注入临时路径、时钟。状态字段为列，展示 payload 可为 JSON。至少包括以下表；实施时可按这些职责命名，不拆成多个数据库。

| 表 | 核心字段与约束 |
| --- | --- |
| `follow_ups` | id、owner/agent/project、status、version、authorization_revision、next_check_at、fixed_check_at、expires_at、timezone、missing_evidence_policy、check_interval、allowed_help、检查租约/fence、通知目标列、创建/更新时间 |
| `follow_up_sources` | item_id、kind、source_key、authorization_revision；唯一 `(item_id, kind, source_key)`；按来源反查 |
| `follow_up_requests` | owner_id、request_id、payload_hash、result_id、action；唯一 `(owner_id, request_id)`，删除项后仅留无内容幂等墓碑 |
| `follow_up_checks` | id、item_id、trigger_slot、authorization_revision、evidence_fingerprint、status、lease/fence、开始/完成时间；唯一 `(item_id, authorization_revision, trigger_slot)` |
| `follow_up_decisions` | check_id 唯一、action、reason_code、policy/model_version、成本、来源/产物引用；无私密全文 |
| `follow_up_deliveries` | id、item_id、decision_id、stable_key 唯一、target 列、status、not_before、expires_at、external_receipt、安全版本 |
| `follow_up_artifacts` | id、item_id、authorization_revision、relative_path、hash、valid、created_at |

owner 级每日额度与冷却读取本域 delivery 的时间/状态列并在同一事务预占。`reserved / sending / sent / unknown` 占用额度；明确失败/取消释放；相同 delivery 重试不重复预占。固定提醒不占条件性建议额度，仍单独计数。

事项、下次检查和调度期望同事务保存；watched JSON 是可重建投影，不是业务状态。数据库提交成功、事件文件写入失败时返回“已保存，调度待恢复”，不说“已安排”；共享服务重建成功后才确认调度就绪。客户端用同一 requestId 重试不得重复创建。

启动和每 60 秒通过一个系统管理的恢复事件扫描本域到期/未投影事项，按稳定文件名写临时文件后 rename。恢复事件由 TaskScheduler 启动时确保存在，不依赖它自己成功运行后才能重建。终态或旧版本事件删除；不清理用户独立 Runtime Task。

删除先事务内失效授权、取消未发送 delivery、删除内容与产物元数据，再清理派生文件/事件投影。失败文件清理可重试，读取入口始终先查授权；墓碑不得保留原对话、标题或生成材料。已发到用户渠道的消息不能声称可远程收回。

## 5. 状态转换

| 动作 | 前置状态 | 结果与副作用 |
| --- | --- | --- |
| create | 无事项、可信明确授权 | active，保存下次检查和投影期望 |
| snooze(until) | active，未来时间且早于有效期 | 仍 active，修改下次检查；固定核对若被影响须明确确认 |
| pause | active | paused，撤销未开始检查与未发送消息 |
| resume | paused，权限仍有效且未过期 | active，重新计算未来检查，不批量补发旧槽位 |
| complete | active/paused，用户确认或约定的确定性完成证明 | completed，终止检查；不联动验收 Plan |
| cancel | active/paused | cancelled，终止检查，保留可查看记录 |
| expire | active/paused，到有效期 | expired，无自动续期 |
| delete | 任意状态 | 不再可读，撤销产物与未发送消息，清理本域副本 |

终态不直接恢复；新委托走新 requestId。来源撤销使事项 paused，标明需调整范围；总开关关闭保留事项状态但运行闸门禁止检查/通知。重新开启重算未来槽位。

多个来源与事项重叠不允许串行化整套聊天；检查独立于 Session 忙碌状态。单事项同一时间只有一个检查持有租约。建议检查超时 60 秒、租约 90 秒；过期回收递增 fence，旧任务不能提交。模型调用可取消，失去租约立即停止，不能无限重试。

## 6. 事件与判断流水线

扩展 `InternalEventKind`、`InternalTaskExecutionResult.kind` 和运行时 dispatcher；事件使用 `execution: 'internal'`、`managed.by: 'molibot'`、kind 为 `proactive-check`，新增 payload `{ itemId, authorizationRevision, triggerSlot }`。不内嵌敏感材料、渠道凭证或普通用户可编辑授权位。

稳定事件名由事项 ID、授权版本和槽位 hash 生成；事件文件不可直接赋予权限。处理器总是回读数据库。周期检查由事项约定投影为 one-shot 到期事件，按成功检查后的下个槽位重建；变更通知可提前投影 immediate 事件。固定核对和条件性检查使用不同 triggerSlot，各自保存进度，调度取最早到期时间；提前检查或条件性冷却不得消费固定核对槽位。

Phase One 先确保时间触发完整贯通，再接 Plan/执行的共享变更通知；文件变更以到点比对 hash 为基本保证，不依赖新增全盘 watcher。变更事件是加速提示，丢失后下次检查仍能取证。

处理顺序：

1. 校验开关、owner、状态、授权版本、有效期、触发槽位并 claim 检查；陈旧事件 no-op。
2. 对条件性检查先筛冷却/额度/安静时段；受抑制则安排具体未来时间，不能把检查标为完成后永远丢弃。固定核对独立判定。
3. 最多读取 1 个 Plan、1 个关联执行结果、3 个指定 UTF-8 文本文件；各文件最多 64 KiB，模型总输入最多 8k tokens。超限/二进制标为不可用，不把截断正文用于“确认不存在某章节”。
4. 收集来源版本/hash；没有变化且无固定核对则 silent，不调模型。缺来源时按委托策略处理；`ask_at_check` 仅在约定检查点询问，`notify_unavailable` 受同一通知预算和错误指纹冷却限制。
5. 必要时一次模型分析，输出校验 schema：action、来源证据 ID、简短理由、给用户的文本、可选派生材料；模型不得调用写工具。建议每轮 4k 输出 tokens、最多一次模型请求、无自动修复循环。
6. 验证引用存在、授权未变、完成判断不越权；材料先写临时文件，提交有效元数据后才可见。未引用真实来源的事实不得作为确定进展发布。
7. 判断/材料引用/待发送意图与下次检查同域事务提交；检查失败不会丢掉已约定固定提醒。
8. 投递器再校验当前授权和策略，成功/失败/不确定分别记录。提交后的重复事件只复用现有决定，不重复生成产物。

模型超时、结构解析失败：条件性分析记 `analysis_failed` 并安排下次检查，不编造建议；固定提醒用结构化委托生成“按约定核对；本次未能核实进展”消息。此失败输出是确定性提醒契约，不是用旧架构兼容分支。

## 7. 通知、恢复与撤权竞态

### 7.1 确定性策略

默认提案沿 PRD：功能关闭、汇总关闭、建议上限每日 2 条、同事项间隔 24 小时。启用时确认时区和安静时段，预填 22:00–09:00；这些是拟实现默认值，不是对用户已有配置的改写。

固定核对使用带时区的绝对时间。创建时若落在安静时段，返回可选的下一允许时间让用户确认，不创建自相矛盾的约定。策略后改导致冲突时，界面显示受影响事项并确认调整；不在运行时悄悄改承诺。DST 不存在或重复的本地时间必须确定具体 UTC 后展示确认。

恢复窗口提案为到期后 2 小时且事项未过期；窗口内标“延迟”，窗口外记录 missed，只在下次正常打开时展示，不批量补发。服务离线/休眠不能保证准点。

### 7.2 共享投递扩展

不能直接调用无回执的 `sendInternalNotice` 后宣称可靠闭环。拟增加共享通知适配，携带稳定 `deliveryKey`、本域意图 ID、授权版本、过期时间和授权目标；渠道只渲染/发送。

共享 outbox 需支持调用方稳定键，唯一 `(channel, instanceId, deliveryKey)`，重复入队返回已有回执；保留现有普通消息入口，不为旧消息补造业务语义。发送前通过共享业务闸门验证当前事项/目标/开关，拒绝取消或过期意图。新增字段和守卫位于共享投递层，不为每渠道分别实现跟进条件。

本域 delivery 与 outbox 不跨库事务：先提交 intent，再以相同 key 入队；启动和系统恢复事件补交 pending intent。只有共享 outbox 负责网络重试，本域不另跑一套重发循环。应保留幂等回执，不能一出队就丢掉 key。

发送前闸门是竞态线性化点：撤权在此之前生效则禁止发送；之后网络请求可能已经提交，记录 `sending/unknown`，不能承诺撤回在途请求。网络不确定/崩溃后的重试遵守既有 at-least-once 边界；提供方无幂等键时仍可能重复，不能宣称 exactly-once。

Phase One 的外部消息只含事项标题、简短状态和材料入口，不外发完整源文件或派生材料；完整材料经鉴权页面读取。已外发内容无法因后续撤权保证收回，首次授权摘要需说明。

## 8. 应用接口与权限

拟新增 `FollowUpService`，Desktop/Web API、Agent 工具与渠道动作共同调用，owner/actor 来自可信运行上下文，拒绝请求体伪造 owner。

| 服务动作 | 输入重点 | 返回/失败 |
| --- | --- | --- |
| create | requestId、委托摘要、可信授权上下文 | item、scheduleState；缺字段返回需澄清，不自动猜测 |
| list/read | projectId、状态、分页 / id | 当前范围内事项与来源状态，敏感内容 no-store |
| update | id、expectedVersion、patch、必要新授权 | 新版本；范围变化未授权则拒绝 |
| control | id、expectedVersion、requestId、pause/resume/complete/cancel/snooze | 幂等结果；延后须带 until |
| delete | id、expectedVersion、requestId | 本域不可再读；不删除外部原始对象 |
| readArtifact | itemId、artifactId、可信 actor | 重新验来源授权；失效即拒绝 |

拟定 HTTP 入口：`/api/desktop/follow-ups` 用 GET 列表/详情、POST 创建和控制、PATCH 更新、DELETE 删除；产物读取 `/api/desktop/follow-ups/artifacts`，细粒度策略 `/api/settings/follow-ups`。Web 复用共享 handler，不复制业务。返回 `{ ok, item?, errorCode?, version? }`；校验 400、未授权 403、未知 404、版本/状态冲突 409、已删除 410，沿用仓库鉴权与请求防护。

Agent 工具 `followUp` 仅暴露 create/list/get/update/control/delete，不接受数据库路径和原始内部事件。工具上下文验证真正授权后才调用 create；未开启功能时返回明确启用入口，不悄悄更改设置。UI 直接操作也走同一服务。

渠道动作绑定 itemId、expectedVersion、actor、目标与过期时间；陈旧按钮返回“状态已变化，请查看最新事项”，不重放旧动作。重启失效按钮可明确提示过期；文本“延后”绑定回复的事项，存在歧义时澄清，不能作用于最近任意事项。

## 9. UI 与设置实现契约

沿用 [DESIGN.md](../../../DESIGN.md) 的自动任务主从结构，在自动任务工作区增加“跟进事项”类型筛选，不新增一级导航；普通任务列表/状态不被重定义。Desktop/Web 同一概念的布局与 token 在实施 slice 内统一，不逐页形成不同中间方案。

列表显示真实标题、状态、下次检查；详情依次呈现委托摘要、来源可用性、最新事实与材料、检查记录、控制操作。无下次时间显示“未安排”，不能占位伪造。保存失败保留草稿，冲突保留本地编辑并展示新版本，不覆盖他处更新。

策略设置独立细粒度保存，用 `.settings-footbar`；中英即时切换、明暗主题、390px 窄宽、键盘操作和可访问名称均为验收项。响应式筛选/选中项用显式派生状态，不能藏在无参数 helper。

Phase One 无 digest 功能，决策 schema 不暴露 digest；超额消息存为待检查并重新评估有效性，不能日后原样倾倒。相关日报 UI 等 Phase Two 实施。

## 10. 实施 slices 与验证矩阵

| Slice | 可演示交付 | 直接相关验证 |
| --- | --- | --- |
| S1 最小纵向闭环 | 明确委托 → 保存 → watched 检查 → 单文件缺口清单 → Desktop 查看 → 完成停止；同时具备最小开关、授权和隔离存储 | store/service/event/来源/产物/API 行为测试；保存失败、缺文件、未授权和重启恢复 |
| S2 真实进展与判断 | Plan/执行证据、变化触发、受限模型独立草稿、固定核对及失败基本提醒 | 版本变化、无变化不调模型、来源不可读、提示注入、输出无效、固定提醒不丢失 |
| S3 一个私聊渠道 | 选择 Telegram 或飞书之一贯通共享 outbox、操作与回执 | 幂等入队、闸门撤销、未知投递、陈旧/重启按钮与回执缺口；真实账号专项验收另行授权 |
| S4 Phase One 收口 | 控制/删除、策略设置、完整详情、冷路径与试用记录 | round-trip、并发控制、撤权产物不可读、主题/语言/窄宽、服务中断与恢复 |

S1 已包含必要授权与取消约束；后续 slice 不以“之后补安全”为前提。所有必需能力完成才算 Phase One 交付，局部通过不得提升整体能力状态。

必须具备的故障守卫：

- 同 requestId 连点/重复消息只建一项；payload 不同返回冲突。
- DB commit 后、事件 rename 前终止进程，重启可重建检查；旧授权事件不执行。
- 检查持有旧 fence 时用户暂停/修改授权，旧结果无法提交；删除后残留文件不可访问。
- 两进程同槽位触发只产生一份有效判断；日额度并发预占不超额。
- 意图提交后、outbox 入队前终止进程，恢复用相同 key；发送后未记回执呈不确定，不能伪报未发送。
- outbox 排队期间撤权/关闭/到期，网络调用前闸门拒绝；越过线性化点的在途请求正确标记。
- 空输入不调用模型；文件截断/编码错误不证明章节缺失；模型失败仍执行固定基本提醒。
- 同事项跨 Session 不串上下文；跨 owner、项目、Agent、路径穿越与符号链接越界全部拒绝。
- 延后不删除事项；忽略消息不暂停；终态不继续投递；停止本功能不删除用户独立提醒。

新增测试使用临时数据库/隔离 DATA_DIR/本地模型，断言反馈、业务状态和产物，并证明故障可使其失败；入集前连续 5 次通过。设置做 save → 新 store → load 整对象回归。UI 做重启 → 首次打开 → 页面/Session 切换 → 服务中断恢复；涉及原生接口的改动加原生定向验收。

日常只执行 touched slice 测试与相关检查，命令在实现后按实际文件登记。全量 `pnpm verify:feature`、`pnpm test:ui`、`pnpm test:app` 留给整体验收；原生测试入口或构建不可用时明确记未验证，不当作通过。

## 11. 可观测、成本与保留

记录结构化事件：委托创建/控制、来源读取结果、check claimed/stale/failed、decision silent/notify、材料生成、delivery pending/sent/unknown/missed、用户采用。每条含 item/check/decision/delivery ID 和授权版本，不将私密正文或内部控制写回聊天。

详情可查为什么检查、为何没有通知、实际下次时间和未确认投递；`silent` 不等于执行失败，材料生成不等于用户采用。统计与 PRD 的实际帮助、管理成本、持续委托和单位价值成本一致，不把模型宣称有用计作成功。

建议非内容运行记录保留 30 天；有效委托和产物保留至删除或授权到期，到期即隐藏产物并在 7 天内清理派生内容；无内容幂等墓碑保留 30 天。共享投递 key/回执至少覆盖本域重放窗口，删除不应导致旧请求复活。具体周期是实施默认提案，需在隐私说明中公开，不无限期积累全文。

模型预算采用服务内限制，Phase One 不增加复杂的高级配置面板；超时/token/费用实测写入判断。成本或异常超限时停止条件性分析，保留固定基本提醒与可见错误状态。

## 12. Phase Two / Three 接口边界

Phase Two 在现有 Memory/Profile 上增加带场景的偏好和可撤销行为规则，不扩充本域为事实库。新增类别退订、digest 决策与汇总调度时再扩展 schema、反馈与评测；不得提前实现隐藏入口。反馈不改权限、系统提示或 Goal 状态。

Phase Three 选择一种外部来源后，再为 `SourceRef` 和授权增加经过评审的适配；撤权/时效/未知状态契约与内部来源相同。选定写操作进入既有审批和执行链路，以实际结果验收，不在 FollowUpService 内新增执行器。

允许后续演进，不为尚未批准的集成写兼容层或空插件框架。Phase One 只有一个项目事项也必须有稳定身份、来源与权限边界，不能以调用方特判代替共享服务。

## 13. 评审与交付记录

实施前确认：首个真实委托及必需章节；私聊渠道选择；PRD 建议默认值与本文件恢复/预算/保留提案；自动任务筛选与详情的设计条目。它们属于方案评审输入，不要求本次生成 spec 时连接服务或运行代码。

实施交付时按 slice 登记实际文件、定向检查命令、故障注入结果、冷路径证据和剩余限制；产品能力真实变化时同步能力矩阵，实施事实入 features，发布摘要按需入 CHANGELOG。本 spec 生成本身不代表任何阶段已实现。
