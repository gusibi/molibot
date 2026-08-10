# 自动持久化长任务与多日执行 PRD

> 状态：实施中，Slices 1–6 部分交付（2026-08-10）
>
> 优先级：P1
>
> 产品名称：长任务（用户可见）/ Durable Execution（架构术语）
>
> 主验收 seam：通过真实 Chat API 和可重启的临时服务验证完整行为；本地 OpenAI-compatible provider fixture 的 live suite 已通过，外部渠道/冷启动矩阵仍待完成

### 当前实施状态

已交付的基础主链路：确定性启用与 per-request `auto/force/suppress`、接受的 Session Plan 幂等转换为多步骤 Durable Execution、每 attempt 一个步骤并写入 run-detail evidence、专用 `durable-execution.sqlite` 聚合、版本 CAS/lease、watched event JSON + runtime internal event 续跑、fresh automation attempt、步骤/证据/decision 状态、副作用 intent/receipt、共享 verifier、任务级预算/未终结配额/队列顺序、共享 one-shot catch-up window 与 missed-event recovery，以及 Desktop 会话卡片、Plan 状态投影、单一右侧 inspector、进行中侧栏和反馈/通知链路。普通 Run 的首次非纯工具边界现在还会经过分层限次、结构化模型 preflight；确认升级后会吸收已执行前缀、证据和回执，并在当前副作用执行前安全交接到 Durable Execution。恢复路径已接入 queryable 外部状态探针注册表，并在没有探针或结果不确定时 fail closed；证据读取器只解引用当前任务已授权的 run-detail，带 owner/Project/Session 边界、24KB 上限和不可信标记；审批请求、重复次数、来源渠道通知以及共享 `/durable` 短句柄动作也已落到同一 Durable 聚合。Web API 的虚拟 profile 会在入队前解析为实际可用的 Web manager，避免任务入队后因 manager id 不存在而失败。

仍待交付的关键验收项：完整的冷启动/跨渠道验收矩阵（包括真实渠道 transport、重启后的来源通知和恢复后的 Agent 证据读取），以及外部 provider 下的同等 live 验收。本次已用真实 `/api/chat`、临时 `DATA_DIR`、本地 OpenAI-compatible provider 和同库服务重启验证：`profileId=personal` 成功路由到 `default` Web manager，provider 请求已发出，重启后公开 API 返回 `recovery_required` 与 `interrupted` attempt。离线事件超窗、queryable 无探针、证据目标丢失和审批越权已有临时库/单元守卫；这些测试不能替代剩余的冷启动/跨渠道验收。

## Problem Statement

Molibot 目前能够可靠完成单轮任务，也已经具备 Run 预算、Agent Context 持久化、工具回执、入站队列隔离、`recovery_required` 状态、定时任务 lease 和有限的中断恢复。但是这些能力保存的是一次 Run、一次工具调用或一条队列记录的状态，不是一个可能持续数小时或数天的用户目标。

当任务需要多个依赖步骤、跨越一次 Run 的预算、等待审批或用户决定，或者在执行过程中产生文件写入、消息发送和外部 API 调用等副作用时，当前系统无法完整回答：

- 最终目标和验收标准是什么；
- 哪些步骤已经真实完成，证据在哪里；
- 哪些外部副作用已经发生；
- 进程中断时，最后一个能够安全继续的位置在哪里；
- 恢复后应跳过、查询、重试还是请求用户判断；
- 模型的“完成”陈述是否真的满足了用户目标。

因此，长任务中断后仍可能只能从原始 prompt 重新开始，或者因为担心重复副作用而停在错误状态。即使模型只完成了一部分，也可能给出读起来像成功的最终回复。用户必须依赖聊天记录和人工记忆追踪项目进度，无法把 Molibot 当成可信赖的多日执行者。

同时，用户不应该每次手动选择“长任务模式”。系统需要默认开启长任务识别：当模型判断一个请求需要持久化执行时，在产生实质副作用前自动创建 Durable Execution；普通问答和可以安全在单轮完成的简单动作仍沿用现有快速路径。

## Solution

新增共享 Agent 层的 `Durable Execution` 聚合。它代表一个跨 Run、可验证、可暂停、可恢复的用户目标，与现有 `Runtime Task` 严格分离：

- `Runtime Task` 继续专指用户可管理的 todo、一次性提醒和周期自动化；
- `Durable Execution` 负责长任务本身的计划、步骤、证据、副作用、等待状态和恢复；
- `Runtime Event` 可以触发一次 Durable Execution 续跑，但不成为其状态来源。

Durable Execution 持久化：

1. 用户目标、约束和可修订的验收标准；
2. 带版本号的线性执行计划；
3. 每个步骤的状态、尝试次数、输入摘要、输出引用和执行证据；
4. 外部副作用的执行意图、幂等键、回执和可查询性；
5. 等待用户或等待审批的问题、允许选项和最终决定；
6. 当前安全恢复点，以及恢复前必须进行的核验；
7. 任务级验证结果和最终状态。

V1 使用线性步骤，不建设通用 DAG。计划可以在执行中修订，但每次修订都保留版本和原因；已完成步骤不能因计划改写而失去证据。

### 存储形态

**唯一真相是一个专用 SQLite 库**：`<dbDir>/durable-execution.sqlite`，与既有的 `settings.sqlite`、`sessions.db`、`inbound-queue.sqlite`、`outbox.sqlite`、`mory.sqlite` 同级。计划、步骤、验收标准、副作用与决定都是数据库行，不是 md 也不是 JSON 文件；测试一律使用临时库；不向用户 Project 根目录写入任何状态文件。

这些取舍的完整理由（为什么按域分库、为什么不用文件承载状态机、跨库无外键的后果）是全局架构决策，记录在 [ADR 0004: Per-domain databases and machine-owned state representation](../adr/0004-per-domain-databases-and-state-representation.md)，本 PRD 只声明本功能如何遵循它。

主要表（V1）：

| 表 | 存什么 |
| --- | --- |
| `executions` | 目标、约束、owner/Bot/来源 Chat/UI Session/Project、当前状态、当前 plan 版本、lease owner 与到期、预算计数 |
| `plan_versions` | 版本号、修订原因、作者（`model`/`user`）、创建时间 |
| `steps` | `(execution_id, plan_version, index)` 有序步骤、状态、尝试次数、副作用类别、幂等键、输入摘要、输出引用 |
| `acceptance_criteria` | 条目、是否必需、checker 绑定或主观标记、作者、所属版本、最近判定结果 |
| `side_effects` | 意图与回执两条记录、人可核对引用（目标、时间戳、内容摘要、外部 id）、幂等键、可查询探针 |
| `evidence_refs` | 指向既有 artifact / run-detail 存储的安全引用，不复制内容 |
| `decisions` | 问题、允许选项、创建版本、答案、回答者、状态 |
| `attempts` | 进程 owner、起止时间、结束原因、消耗预算、使用的 Agent Context Session id |

本功能对 ADR 0004 的具体落法：

- **同库原子性**：意图与回执必须写在同一个库内的一次事务里；这是本功能唯一的强原子性要求，它决定了 `side_effects` 不得拆分到别处。
- **列与 JSON 列**：状态、版本、owner、步骤序号、副作用类别、幂等键、lease 归属和时间戳是真正的列；输入摘要、回执 payload、checker 参数可放 JSON 列。
- **大内容不入库**：stdout、生成文件、trace 留在既有 artifact / run-detail 存储（它们是磁盘上的文件与 JSONL，不是数据库行），库里只保存安全引用；这正是证据读取器解引用的对象。
- **跨存储引用必须 fail soft，并由本功能自己保证生命周期**：`evidence_refs` 与 `attempts.sessionId` 的目标不受外键保护，也不可能受——它们不是行。因此 (a) 保留策略按 execution 终态计，活跃执行的引用在其存活期间必须一直可解；(b) 每条引用同时冗余存储一份足以独立渲染的摘要（标题、大小、时间、内容哈希），目标消失时界面仍有可读内容；(c) 解引用失败返回明确的"该证据已不可用（已过期 / 已清理）"，attempt 继续执行，绝不因此崩溃或把步骤误判为失败；(d) 启动 reconcile 顺带标记失效引用，使它成为已知状态而不是执行中途才发现的意外。
- **md 的合法位置是导出**：用户要"给我一份这个任务的报告"时，从结构化状态渲染 md / HTML 快照，可写入用户指定位置；渲染产物永远是只读快照，任何路径都不得回读为状态来源。
- **模型不得直接写这个库**：所有变更走共享 coordinator 的动作，带 version CAS 与 lease 校验。模型只能提出计划修订建议、声明"准备验收"。

### 自动启用

长任务识别默认开启，不提供一个要求用户主动打开的模式开关。但**「默认开启」指的是这条通道永远可用，不是每一轮对话都要先跑一次分类模型**。运行时无法在调用模型之前"证明"一段自然语言没有执行需求——能做这个判断的只有另一次模型调用，所以「总是预分类」和「简单对话跳过预分类」不可能同时成立。V1 采用两条确定的启用路径：

**路径 A：确定性信号，立即创建。** 无需模型判断即可成立的信号出现时，在本轮执行任何工具之前创建 Durable Execution：

- 用户明确表达多日执行、稍后继续、持续推进、定期汇报等跨会话意图；
- 用户显式使用长任务命令或 per-request override 强制创建；
- 续跑事件、恢复入口等本身就携带既有 Durable Execution id 的入口。

**路径 B：惰性升级（lazy promotion），挂在首次非纯只读动作边界上。** 其余请求一律先走现有普通 Run，不额外付出分类延迟和成本。以下任一条件先触发时，在**执行动作之前**暂停并判断是否升级为 Durable Execution：

- 即将调用任何声明为 `idempotent`、`queryable` 或 `non_idempotent` 的工具；只有 `pure`/只读工具不触发，因此简单文件修改可能支付一次 preflight 成本，但普通问答和纯查询不会；
- 本次 Run 已消耗超过配置阈值的预算比例，且模型仍在推进未完成的多阶段工作；
- 模型显式提出一个包含多个依赖阶段、或需要中途审批/用户决定的计划。

升级判断本身使用一次轻量、结构化的模型 preflight，返回 `mode`、`reason`、`goal`、初始 `acceptanceCriteria`、预期等待和副作用风险。

**分类次数上限按副作用等级计，不按 Run 计。** 把上限简单写成"每个 Run 最多一次"会在最危险的那一刻关掉判断：一个 Run 先做一次 `idempotent` 文件写入、preflight 判 `ordinary`，十步之后模型执行一次 `non_idempotent` 的发送——那次发送是整份 PRD 里唯一真正不可回滚的动作，却因为"本 Run 已分类过"而完全不经过长任务考量。分类发生在信息最少的时刻，风险出现在之后。因此规则是：

- 同一副作用等级在一个 Run 内最多触发一次 preflight；得到 `ordinary` 后，该等级的后续工具直接放行；
- **首次出现更高副作用等级时必须重新判断一次**，等级序为 `idempotent` < `queryable` < `non_idempotent`；
- 由此每个普通 Run 最多 3 次 preflight，实际绝大多数请求是 0 次或 1 次，成本仍然有界。

预算阈值耗尽或模型后来明确提出多阶段/待决计划属于**确定性升级信号**，直接创建 Durable Execution，不再请求分类。确定性升级使用原始请求、当前显式计划和本轮已执行前缀生成初始目标与验收标准；生成失败则可见失败，不能继续作为无管理 Run 产生副作用。

**中途升级必须吸收本轮已经执行过的工作。** 这是惰性升级的核心要求，不能留给实现推断：升级发生时，本轮 Run 中已经完成的工具调用按发生顺序被写入为已完成步骤，并携带它们真实的回执作为证据；没有回执的调用写为 `uncertain`，按其副作用类别处理。升级不得丢弃、也不得重放这些已发生的动作。若吸收过程本身失败，本次请求以可见错误结束，不允许"降级成一个没有记录的普通 Run"继续产生副作用。

其他约定：

- 步骤数量本身不是判定标准，关键是是否需要跨 Run 状态、恢复或任务级验收；
- 用户可以明确要求本次不要创建长任务（抑制），也可以把普通任务提升为长任务（强制）；
- 分类结论、触发路径、原因和置信度记入运行事件，不作为普通对话消息持久化，也不污染后续 Agent Context。

无论走哪条路径，一旦判定为长任务，系统必须先写入初始目标、验收标准和第一个安全步骤，然后才允许执行会产生副作用的工具。

### 状态模型

Durable Execution 的任务状态包括：

| 状态 | 含义 |
| --- | --- |
| `planned` | 已创建目标和计划，尚未开始执行 |
| `queued` | 有可执行的下一步，但正在等待一个并发槽位；没有 lease，也没有待办 |
| `running` | 当前有一个受 lease 保护的执行 attempt |
| `verifying` | 步骤执行结束，正在验证任务级验收标准（仍是活跃 attempt，不得执行副作用步骤） |
| `waiting_for_user` | 系统需要用户决定后才能安全继续 |
| `waiting_for_approval` | 等待现有审批系统的明确授权 |
| `paused` | **用户主动**暂停，不存在待回答的问题，不会自动续跑 |
| `recovery_required` | 上次执行中断，自动恢复前需要核验或人工决定 |
| `partial` | 终态。已产生有用结果，但存在未满足的必需验收条件，且不存在可自动继续的路径 |
| `completed` | 所有必需验收条件均有可信证据 |
| `failed` | 已达到失败边界，且不存在安全、有效的继续路径 |
| `cancelled` | 用户明确取消，后续 continuation 不得再启动 |

`queued` 存在的原因是并发上限：一个已经跑过、下一步就绪、但在等槽位的执行既不是 `planned`（它早就开始了）也不是 `running`（它没有 lease）。没有这个状态，排队中的任务只能被错误地显示成"进行中"却永远不动，正是本 PRD 反复要求避免的"静止无解释"。`queued` 不占并发额度，不产生通知，但必须在界面上说明"排队中 · 前面还有 N 个"。

`paused` 与 `waiting_for_user` 必须是两个状态，不得合并：前者由用户发起、没有待办、不产生提醒；后者由系统发起、有一个明确的 open decision、必须提醒用户。把主动暂停塞进等待态会让恢复逻辑和 UI 无法区分"我让它停的"和"它在等我"。

`partial` 是**终态**。判定口径固定为：存在未满足的必需验收条件，且原因不是"等用户/等审批/被暂停"（那些是等待态），而是任务级预算耗尽、失败边界到达、或纠正循环用尽。终态的含义是不再自动续跑；用户仍可显式发起一次"继续"，该操作创建新的 plan 版本与新的 attempt，而不是把旧的终态改回 `running`。

步骤状态包括 `pending`、`running`、`completed`、`uncertain`、`blocked`、`skipped` 和 `failed`。进程启动时，任何由旧进程持有的 `running` 步骤必须先转为 `uncertain`，不能直接变回 `pending`。

用户可见状态由共享投影从上表折叠而来，桌面端与各 Channel 使用同一份折叠结果（见「macOS 桌面端展示」）：`running` 与 `verifying` 合并显示为「进行中」，两个 `waiting_*` 合并为「等待你」并用 `waitKind` 区分文案。折叠只发生在展示层，状态机本身不得减少状态。

### 安全恢复

每个可能产生副作用的步骤执行前先记录意图，执行后再记录机器回执。**意图与回执都必须携带足以让人自己去核对的外部引用**——目标对象（收件人 / 会话 / 文件路径 / API 资源）、时间戳、内容摘要和外部返回的 id（若有）。这不是可选的可观测性增强：当一个 `non_idempotent` 步骤最终要问用户"这条消息发出去了吗"，用户手上除了这条记录没有别的判断材料；缺少引用时唯一理性的选择是永远不回答，任务就永久卡在等待态。

步骤按恢复特性分类：

- `pure`：无外部副作用，可以安全重试；
- `idempotent`：带稳定幂等键，可以安全重试；
- `queryable`：可能已发生，恢复时必须先查询外部状态；
- `non_idempotent`：无法查询且可能重复产生影响，中断后必须等待用户决定。

恢复流程读取真实步骤记录，而不是重新提交原始 prompt：

1. 验证 task lease 所有者已经失效；
2. 检查最后一个 `running`/`uncertain` 步骤的意图、回执和外部状态；
3. 跳过已有可信完成证据的步骤；
4. 仅重试 `pure` 或具有有效幂等边界的步骤；
5. 对可查询副作用先查询，再决定补记完成或重试；
6. 对不可判定的非幂等副作用进入 `waiting_for_user`；
7. 从第一个安全的未完成步骤继续，并保留同一个 Durable Execution id。

**在 `verifying` 中断**是一个独立分支，必须显式定义：验证过程本身不产生外部副作用（判定用的探针必须是只读的），因此中断后不进入 `uncertain`，而是丢弃未完成的验证结果、回到 `verifying` 重新完整跑一遍验收。已经产生结论的单条 criterion 结果可以保留并跳过，前提是它绑定的是确定性 checker；judge model 的结论在跨进程恢复后一律重算。若验证在同一 plan 版本上连续中断达到上限，进入 `recovery_required` 而不是无限重试。

**与既有 `recovery_required` 队列行的关系（单一真相）**：入站队列的 `recovery_required` 行（P1-210）与 Durable Execution 的 `recovery_required` 状态是两个记录，但**只能有一个面向用户**。一旦某个 Run 被某个 Durable Execution 拥有，队列行降级为纯触发器：它可以驱动一次恢复调度，但不再独立生成用户可见的中断提示、不再独立出现在任何列表或通知里，其用户可见表达一律由 Durable Execution 投影产生。否则同一次崩溃会让用户看到两个"中断"，正是「一个概念两个宿主分支」的重演。

跨 Run 自动续跑通过受控的内部 Runtime Event 触发。事件只携带 Durable Execution id 和预期版本，真实目标、计划和 checkpoint 始终从 Durable Execution store 读取。不得使用 memory、普通聊天消息、OS scheduler 或盲目 prompt replay 作为恢复机制。

**离线与补跑窗口**：Molibot 服务不运行时长任务不推进，这是既定边界（见 Out of Scope）。因此续跑事件在离线期间会堆积，重启后的处理规则固定为：同一个 Durable Execution 的多个堆积续跑事件合并为一次续跑（版本与 lease 校验让重复触发成为 no-op）；错过的续跑只在配置的补跑窗口内自动执行，超出窗口的报告为"因应用未运行错过了 N 次续跑"，等待下一个正常窗口或用户手动继续，绝不批量补做有副作用的步骤。用户可见状态必须显式表达"在等下一个窗口"和"需要应用保持运行"，否则静止会被读成卡死。

### 执行上下文与 attempt

一个 Durable Execution 会跨越多个 attempt，每个 attempt 复用现有 Runner。**每个 attempt 使用一个新建的受控 Agent Context，而不是延续同一个长寿命 session。** 这是实现层面最贵的一个决定，必须在 PRD 层面定死：

- 延续同一个 session 会让跨天的上下文被 compaction 反复压缩，长任务恰好是最容易撞上单条超大工具结果与不可恢复压缩的场景；
- 新建 context 则要求 Durable Execution 自己产出 briefing：目标、约束、当前有效的验收标准、已完成步骤及其证据摘要、当前步骤的输入、上一次失败的原因，以及每份完整证据的安全引用。briefing 是下一个 attempt 的**默认上下文和证据索引**，不是它唯一能够访问的知识；把大结果只压成摘要会永久丢失实现细节。
- 当前 attempt 必须拥有一个共享、只读、按需的证据读取能力，只能解引用当前 Durable Execution 已授权的 evidence/artifact/run-detail 引用。读取复用现有路径与 owner/Bot/Project 边界，应用单次与累计输出上限，返回截断信息，并把外部内容继续标记为不可信证据；它不能搜索其他 automation Session、其他任务或普通会话的隐藏工具结果。
- briefing 由结构化状态生成，不得注入调试细节、分类结论或历史 prose。

attempt 使用的 Agent Context Session 一律标记为 automation 来源，**不得出现在任何会话列表表面**（侧边栏、会话浏览器、外部 `contexts/` 投影、更多会话弹窗）。用户进入这些内容的唯一入口是长任务详情里的步骤与证据链接。原始发起会话（用户真正对话的那个 Session）保持普通会话身份并与 Durable Execution 双向关联。

**待决问题与审批请求必须呈现在用户可见的来源表面，而不是发起它的隐藏 attempt session。** 这两条约束在同一处相交：attempt session 被要求从所有会话列表表面过滤掉，而审批 grant 又绑定在这个 attempt session 上。如果审批卡片本身也只落在那个隐藏 session 里，用户永远看不到它，任务就死在 `waiting_for_approval`，表现为"卡住了但哪都找不到要批什么"。因此：decision request 与 approval request 一律渲染在**发起该长任务的 UI Session 与来源 Channel**；attempt session 只是它们的产生地和授权作用域，不是呈现位置。桌面端另有侧边栏与顶栏两条冗余入口（见「macOS 桌面端展示」）。

**审批作用域不得因跨 attempt 自动扩大。** 现有 Approval 的 session grant 继续按具体 Agent Context Session id 匹配；在 Durable Execution 中，用户选择“本会话允许”时，界面必须明确写成“本次执行期间允许”，它只覆盖当前 attempt，attempt 结束即失效，不继承到下一次 fresh context。待审批的 exact action 获批后仍按既有流程只执行一次并把回执写回当前步骤。V1 不新增 task-wide approval；如果未来需要“整个长任务允许”，必须作为新的安全产品决策单独设计，不能把来源 UI Session 的授权静默扩散给隐藏 attempt。

这个选择有一个必须被正视的产品后果：一个跨 5 天、每天 3 个 attempt 的任务，同一个授权会被问 15 次，每次还配一条系统通知。真实结果是用户开始无脑点同意，安全性反而下降。V1 不用放宽作用域来解决它，但必须让它可见——重复请求同一授权时，界面显式标注「这是第 N 次请求同一授权」，把"要不要放宽"变成用户的一次自觉决定，而不是被疲劳消耗掉的默认行为。重复计数同时进入运行指标，作为未来是否引入 task-wide grant 的依据。

### 预算、并发与配额

自动启用意味着用户并没有主动选择开销，因此任务级上限是必需的，不是优化项：

- **任务级累计预算**：每个 Durable Execution 有累计 token / 累计 attempt 数 / 最长生命周期（天）三个上限，可配置。任一上限耗尽时进入 `partial`，写明"因达到任务预算上限而停止"，并列出已完成与未完成的验收条件。绝不静默继续。
- **单 attempt 预算**继续由现有 Runner 预算体系负责，不被本功能替换。
- **全局并发上限**：同一 owner 同时处于活跃（`running`/`verifying`）状态的 Durable Execution 数量有上限，超出的进入 `queued` 状态，按创建顺序取得 attempt 机会；`queued`、等待中、暂停中的任务不占并发额度。排队位置必须可见（「排队中 · 前面还有 N 个」），排队本身不触发通知。
- **活跃任务总数上限**：同一 owner 未终结的 Durable Execution 总数有上限，达到上限时新的自动升级被拒绝并明确告知用户（显式 override 仍可创建）。没有这条，自动启用会在一周内攒出几十个未结任务，模型开销和 UI 都会失控。
- 预算与并发的当前占用必须可见，而不只是在耗尽时才出现。

### 任务级完成判定

模型不能直接把 Durable Execution 标记为 `completed`。模型只能声明“准备验收”，由共享 verifier 根据验收标准和证据决定结果：

- 文件、SQLite、API 状态、工具回执、测试和构建优先使用确定性验证；
- 主观质量标准可以使用 judge model，但没有 judge 或证据不足时必须是 `unproven`，不能自动通过；
- 必需条件全部通过后才能进入 `completed`；
- 一部分通过且不存在可自动继续的路径时进入 `partial`，并明确列出已完成和未完成项；
- 用户可以明确修改或豁免验收条件，该决定必须结构化记录并产生新的计划版本。

**验收标准的来源必须被约束。** 初始 `acceptanceCriteria` 由 preflight 的模型产出，如果不加约束，"模型不能自己宣布完成"这条保证就被绕过了——模型可以写一条宽松到必然通过的标准，再让 verifier 判自己通过。因此：

- 每条 criterion 必须绑定一个确定性 checker；无法绑定的标记为主观条件，只能由 judge model 评估，且在 judge 不可用或证据不足时固定为 `unproven`；
- 一个任务如果**所有必需条件都是主观条件**，不允许自动进入 `completed`，只能提交用户确认；
- 创建 Durable Execution 时，验收标准必须与目标一起呈现给用户，并允许当场修改或删除，而不是只在执行中途才可修订；
- 每条 criterion 记录作者（`model` / `user`）与所属计划版本；用户改写过的条件不得被后续计划版本自动覆盖。

### 用户控制与可见性

用户在所有支持的聊天表面都能看到长任务已自动启用、当前阶段、已完成步骤、等待事项和下一步。状态表达由共享上层生成，Channel 只负责平台展示和消息收发。

V1 至少支持：

- 查看自己的活跃和最近长任务；
- 查看一个长任务的目标、验收标准、步骤、证据摘要和最近错误；
- 暂停、继续、取消和显式重试；
- 回答一个待决定问题；
- 在计划执行中补充约束或修改目标；
- 明确看到 `completed`、`partial`、`waiting`、`paused`、`recovery_required` 与 `failed` 的区别；
- 从原始会话和 Project Session 打开对应长任务，不暴露宿主绝对路径。

**Channel 上的状态变更控件采用能力驱动的共享契约。** 暂停、继续、取消、回答决定始终调用同一组带 Durable Execution id、预期版本和一次性 action id 的共享动作；Channel 只选择自己真实支持的表现形式：

- 支持交互卡片的平台在回调窗口内先返回无按钮的“处理中”卡，动作恰好执行一次，随后按原始消息 id 更新为明确的成功 / 已失效 / 失败结果；更新失败时降级为同样内容的文本回执；
- 不支持原生按钮的平台（当前包括 QQ、微信）显示明确的回复格式或 `/longtask <action> <handle> [version]` 文本命令；只有一个匹配中的待决动作时可以接受自然语言短回复，多个待决动作时必须要求 handle，绝不猜测；
- **文本命令里出现的必须是短句柄，不是 `executionId`。** 没有人会在微信里手打一个 UUID——用不可输入的标识写兜底路径，等于没有兜底路径。系统为每个用户当前未终结的长任务分配一个短句柄（如 `#3` 或 6 位码），在该用户作用域内唯一且稳定，随提示一起显示；句柄只做寻址，真实鉴权仍按 owner/Bot/版本在共享层完成，猜中一个句柄不构成越权；
- 回调/命令到达、共享动作结果、用户回执结果三者分别落日志，使“输入没到”“动作失败”“回执失败”可区分。

两种表现共享完全相同的授权、版本校验和幂等语义；不得为了无按钮 Channel 在 Channel 层复制任务状态机。

### macOS 桌面端展示

长任务在桌面端有四个表面，全部从同一份共享投影渲染；Channel 与桌面端不得各自推导状态文案。三条硬约束先于具体设计：

1. **一个概念一个宿主。** 长任务详情只有一个宿主组件，不允许出现"面板里一个、会话页再并列一个"的两个分支——那样其中一个必然不可达，而不可达会被读成渲染 bug。
2. **任务进度不是消息。** 状态变化一律原地更新既有卡片，绝不向 transcript 追加新消息。跨天的长任务会产生几十次状态变化，追加式渲染会刷屏并不断打断滚动吸底。
3. **静止必须解释。** 长任务大部分时间没有动静，任何静止状态都必须给出原因和下一步时间点，否则一律被读成卡死。

#### A. 会话内：原地更新的长任务卡（主表面）

创建时在 transcript 插入一张卡片，之后永远原地更新，形态沿用现有运行活动卡的折叠模式：

- **折叠态（默认，一行）**：`进行中 · 步骤 3/7 · 正在写入周报` + 细进度条 + 右侧 `暂停` / `详情`；
- **展开态**：步骤列表（已完成打勾并显示耗时、当前项转圈、未开始灰显）、待决问题、最近一次错误；
- `waiting_for_user` 时卡片本身承载选项按钮，形态与既有审批卡一致，并复用同一套一次性落库语义；
- 终态折叠为一行摘要（`已完成` / `部分完成 3/5` / `已失败`），保留进入详情的入口。

卡片数据必须通过会话控制器的 view store 读取。桌面端 legacy 反应式语句无法订阅跨模块 runes 状态，直接读会在首次打开时静默失效——这是本项目反复出现过的失败模式。

#### B. 右侧面板：新增「任务」inspector

右侧面板已有文件与 Mini App 两种模式，长任务详情作为**第三种模式**加入，而不是在会话页新开一个并列的侧栏。分区自上而下：

1. **恢复提示（仅 `recovery_required`，置顶）**——写给人看，不是给模型看：「重启前正在『向增长周会群发送周报』，无法确认是否已发出。意图记录于 14:32，目标：飞书群『增长周会』，内容摘要：…」，动作为 `已发送，跳过` / `未发送，重试` / `我先去确认`；
2. **目标与约束**——可编辑，保存即产生新计划版本，底部固定操作条；
3. **验收标准**——每条一行：`通过` / `未通过` / `无法验证(unproven)` + 证据链接 + 作者徽章（模型 / 你）+ 是否必需；
4. **步骤时间线**——状态图标、耗时、**副作用徽章**（纯计算 / 可重试 / 需查询 / 不可重复）、证据链接；
5. **待决问题与审批**——问题、允许选项、回答后显示"已由你在 X 时回答"；审批项标注作用域为「本次执行期间允许」，同一授权重复出现时标注「第 N 次请求同一授权」。待决项同时呈现在发起会话的卡片上，面板不是它唯一的入口；
6. **预算与配额**——已用 token / attempt 数 / 已运行天数与各自上限；
7. **计划版本历史**——版本号、修订原因、发起者。

证据点开一律复用现有的代码 / 差异 / 文件查看器，不新建查看器。切换会话时任务面板属于 workspace 级状态，**不得被上下文重置清空**；这与 Mini App 面板同属一类，已经踩过一次。可见性判定与面板 props 必须读同一份实时状态，不能一个读打开时的快照、一个读实时派生值。

#### C. 侧边栏：会话列表之上的「进行中」分组

活跃与等待中的长任务各占一行，复用既有状态点语义色。用户可见状态到视觉的映射固定为：

| 内部状态 | 状态点 | 行内文案 | 主动作 |
| --- | --- | --- | --- |
| `running` / `verifying` | 蓝色脉冲 | 步骤 3/7 · 写入周报（验证中显示"正在核对验收标准"） | 暂停 |
| `queued` | 蓝色静止 | 排队中 · 前面还有 2 个 | 暂停 |
| `waiting_for_user` | 琥珀 + 计数徽章 | 需要你决定 | 回答 |
| `waiting_for_approval` | 琥珀空心 | 等待授权（重复请求时附「第 N 次」） | 跳到审批 |
| `paused` | 灰 | 已暂停 | 继续 |
| `recovery_required` | 红色脉冲 | 重启后需确认 | 确认 |
| `partial` | 琥珀实心 | 部分完成 3/5 | 查看未完成 |
| `completed` | 绿 | 已完成 | 查看 |
| `failed` | 红实心 | 已失败 | 看报告 |
| `cancelled` | 灰空心 | 已取消 | 查看 |

点击任务行 → 打开其原始会话 + 右侧切到任务 inspector。attempt 产生的 automation session 绝不出现在会话列表里，只能从这里的步骤与证据进入。

#### D. 顶栏徽章与系统通知

窗口顶栏放一个全局徽章：`2 个进行中 · 1 个待你决定`，点击弹出任务列表浮层。这是用户切到其他面板或其他会话时唯一还能感知任务在跑的位置。该徽章位于顶部拖拽区内，容器自身必须 `pointer-events: none`、直接子元素 `pointer-events: auto`，否则它的空白区域会变成隐形的窗口拖拽阻断器。

更重要的是：长任务的前提就是用户不在看。进入 `waiting_for_user`、`waiting_for_approval`、`recovery_required`，以及任务终结（`completed` / `partial` / `failed`）时，必须触发 macOS 通知与 Dock 角标。缺少这一步，「等你决定」在产品上等价于永久卡死。

#### E. 显式表达"在等，不是卡死"

以下文案是必需项，不是润色：

- `下次继续：明天 09:00`
- `需要 Molibot 保持运行——应用关闭期间不会推进`
- `已等待你的回答 2 天`
- `因应用未运行错过了 3 次续跑，已在补跑窗口外，等待下一个窗口`
- `排队中 · 前面还有 2 个长任务`

#### F. 与 Settings → 任务列表不合并

Settings 里现有的任务列表是 Runtime Task（定时、提醒、周期自动化）。本 PRD 特意把两个聚合分开，UI 上同样不得合并成一个列表，否则用户第一天就会把两个概念混为一谈。最多在该页放一个指向长任务的入口。

#### G. 样式约束

面板内不使用 `vw` / `vh`（宽度由相邻面板决定，视口单位会保留全窗口尺寸）；多面板栅格给面板 track 设 `minmax(下限, 首选)` 并让内容列吃余量；字号与行高成对使用既有类型标尺变量，不写裸 px；配色只用语义 token，不写按主题分支的硬编码色值。桌面端改动的验收沿用既有约定：`svelte-check` 零错误零警告 + `vite build` + 桌面 UI 测试，并额外走一次冷启动路径（重启服务、首次打开每个受影响面板、切换会话、从服务中断中恢复）。

## User Stories

1. As a Molibot user, I want long-task management to activate automatically, so that I do not need to understand or select an internal execution mode.
2. As a Molibot user, I want ordinary questions to stay fast, so that automatic detection does not turn every conversation into a managed project.
3. As a Molibot user, I want to see when Molibot has classified my request as a long task, so that the extra persistence and execution behavior is not hidden from me.
4. As a Molibot user, I want to override an incorrect long-task classification, so that I remain in control of execution scope.
5. As a Molibot user, I want my original goal and constraints stored separately from chat prose, so that they survive compaction, restart, and multi-day execution.
6. As a Molibot user, I want explicit acceptance criteria, so that “done” has a concrete meaning rather than depending on a persuasive final reply.
7. As a Molibot user, I want Molibot to propose an initial plan before executing a long task, so that I can understand the expected path.
8. As a Molibot user, I want the plan to evolve when new facts appear, so that persistence does not lock the Agent into an obsolete approach.
9. As a Molibot user, I want plan revisions and their reasons retained, so that I can understand why the execution changed direction.
10. As a Molibot user, I want each completed step backed by evidence, so that progress reflects real work rather than model narration.
11. As a Molibot user, I want file writes, API mutations, sent messages, and other side effects recorded, so that a restart does not repeat them blindly.
12. As a Molibot user, I want idempotent operations retried automatically after interruption, so that recoverable failures do not require unnecessary intervention.
13. As a Molibot user, I want uncertain non-idempotent operations paused for review, so that Molibot does not send, publish, purchase, or delete twice.
14. As a Molibot user, I want Molibot to query external state before retrying when possible, so that recovery is based on evidence.
15. As a Molibot user, I want a task interrupted by an app restart to remain visible, so that it never disappears or stays falsely marked as running.
16. As a Molibot user, I want execution to continue from the first safe unfinished step, so that completed work is not repeated.
17. As a Molibot user, I want a clear explanation when automatic recovery is unsafe, so that I know exactly what decision is required.
18. As a Molibot user, I want my answer to a blocking question stored with the task, so that the same question is not asked again after restart.
19. As a Molibot user, I want approval waits to use the existing approval system, so that long tasks do not introduce a second security model.
20. As a Molibot user, I want to pause and resume a long task deliberately, so that I can control timing without cancelling the goal.
21. As a Molibot user, I want to cancel a long task, so that no delayed continuation can restart it afterward.
22. As a Molibot user, I want to modify the goal or constraints while work is in progress, so that the task can adapt without losing completed evidence.
23. As a Molibot user, I want to see completed and remaining steps, so that multi-day progress is understandable at a glance.
24. As a Molibot user, I want partial completion distinguished from success, so that useful intermediate work is preserved without overstating the result.
25. As a Molibot user, I want task-level verification before completion, so that a successful tool call is not mistaken for a successful project.
26. As a Molibot user, I want failed acceptance checks to trigger bounded corrective work, so that the Agent gets a chance to finish instead of stopping at the first verification failure.
27. As a Molibot user, I want repeated corrective failure to stop with an actionable report, so that the Agent cannot loop indefinitely.
28. As a Molibot user, I want a long task linked to its originating Session and Project, so that I can return to the relevant context from any supported surface.
29. As a Project user, I want Durable Execution metadata stored outside my Project root, so that Molibot never pollutes my repository with internal state.
30. As a channel user, I want the same task semantics on Web, Desktop, Telegram, Feishu, QQ, and Weixin, so that recovery behavior does not depend on where I started the work.
31. As an operator, I want structured task and step history, so that I can diagnose why a task is running, waiting, uncertain, partial, or failed.
32. As an operator, I want stale leases reconciled by process ownership, so that age is never mistaken for liveness.
33. As an operator, I want retention limits for completed execution detail, so that multi-day support does not grow storage without bounds.
34. As a developer, I want a single shared execution coordinator, so that channels do not reimplement plan, recovery, queue, or completion logic.
35. As a developer, I want tools to declare side-effect and receipt semantics, so that recovery policy is machine-readable instead of inferred from tool names or prose.
36. As a developer, I want fault-injection evals around real service restarts, so that resumability is measured by outcomes and duplicate effects rather than unit-test confidence.
37. As a Molibot user, I want a task I paused myself to look different from a task that is waiting on my answer, so that only real questions demand my attention.
38. As a Molibot user, I want every recorded side effect to carry the target, timestamp and summary I would need to check it myself, so that an "did this already send?" question is answerable rather than permanently blocking.
39. As a Molibot user, I want acceptance criteria shown and editable when the task is created, so that the definition of done is mine and not whatever the model found convenient.
40. As a Molibot user, I want a per-task cost and duration ceiling, so that an automatically created long task cannot spend indefinitely without my choosing it.
41. As a Molibot user, I want a cap on how many long tasks run at once, so that automatic activation does not silently accumulate dozens of unfinished projects.
42. As a Molibot user, I want to be told when a task is idle because the app was closed or because it is waiting for its next window, so that stillness is never indistinguishable from a hang.
43. As a Molibot user, I want a macOS notification when a task needs my decision or reaches a terminal state, so that multi-day execution does not depend on me watching the window.
44. As a Molibot user, I want long-task progress to update in place instead of posting new chat messages, so that a multi-day task does not flood my conversation.
45. As a Molibot user, I want one interruption to produce one interruption notice, so that a crash does not appear twice under two different systems.
46. As a developer, I want the automation Sessions created by attempts excluded from every conversation list, so that long tasks do not leak internal sessions into the sidebar.
47. As a developer, I want each attempt's context assembled from stored state rather than inherited from a long-lived transcript, so that multi-day execution does not depend on compaction surviving for days.
48. As a Molibot user, I want the classification to be re-evaluated before the first irreversible action, so that an early harmless edit cannot wave a later send through unmanaged.
49. As a Molibot user, I want approval and decision prompts to appear where I actually am, so that a task never waits on something I cannot see.
50. As a Molibot user, I want to be told when the same approval is being asked again and how many times, so that I can decide to widen the scope deliberately instead of clicking through it.
51. As a Molibot user, I want a task waiting for a free slot to say so, so that queueing is not indistinguishable from running or from being stuck.
52. As a Molibot user, I want to act on a long task from a channel without buttons by typing a short handle, so that the fallback path is one I can actually type.
53. As a developer, I want plans, steps and receipts stored as database rows rather than Markdown or JSON files, so that concurrent writes, version checks and post-crash reads have a defined outcome.
54. As a developer, I want the model unable to write task state directly, so that the execution record cannot be edited by the thing it is meant to hold accountable.
55. As a Molibot user, I want a readable exported report of a long task, so that I can share progress without the report ever becoming the source of truth.
56. As a developer, I want read-only core tools declared `pure` in the same slice that ships lazy promotion, so that the conservative default does not tax every ordinary tool call with a classifier.

## Implementation Decisions

- Introduce `Durable Execution` as a new shared Agent Runtime aggregate. It is not a new kind of Runtime Task, not Memory, not a Session transcript, and not a Channel-owned queue row.
- Establish `Durable Execution`, `Execution Attempt`, `Execution Step`, `Acceptance Criterion`, `Evidence`, `Side-effect Record`, `Decision Request`, `Safe Resume Point`, `Activation Path`, `Execution Briefing` and `Task Budget` as the canonical domain terms. Add them to the domain glossary when implementation begins.
- Keep source-of-truth state in a dedicated injectable SQLite store (`<dbDir>/durable-execution.sqlite`) per [ADR 0004](../adr/0004-per-domain-databases-and-state-representation.md). Plans, steps, criteria, side effects and decisions are rows, never Markdown or JSON files. Tests always use a temporary database. No state is written into a user's Project root.
- State-machine fields (status, version, owner, step index, side-effect class, idempotency key, lease ownership, timestamps) are real columns; JSON columns may hold display-only payloads but never a field that is queried, validated or concurrency-protected. Large content stays in the existing artifact/run-detail stores behind safe references.
- Cross-store references have no foreign key and cannot have one — their targets are files and JSONL, not rows. Each reference therefore stores a self-sufficient render summary next to it, dereference failure returns an explicit “evidence unavailable” and the attempt continues, and startup reconcile marks broken references so they are a known state rather than a mid-attempt surprise. Lifetime is owned by retention policy, not by the database.
- The model never writes the store directly. Every mutation goes through shared coordinator actions with version CAS and lease checks; the model may propose plan revisions and declare “ready for verification”. Markdown is an export format rendered from structured state, and a rendered report is never read back as state.
- Create new schema directly for this capability; do not import legacy prompt text or add a compatibility representation. Existing Runs, Runtime Tasks and queue rows remain their own aggregates.
- Scope every Durable Execution by owner and Bot, with optional source Chat, UI Session, Agent Context Session and Project identity. IDs are stable across Runs and channels.
- Use optimistic `version` checks for plan edits and user decisions, plus process-owner leases for active attempts. A stale worker cannot complete or mutate a newer version.
- V1 plans are ordered linear steps. A step may be inserted, skipped or replaced through a new plan version, but arbitrary graphs, parallel dependency scheduling and nested workflows are not part of V1.
- Automatic activation has exactly two paths and never runs a classifier on every conversational turn. Deterministic signals (explicit multi-day/continue-later intent, an explicit override, an inbound continuation carrying a task id) create the task up front. Everything else starts as an ordinary Run and reaches lazy-promotion preflight at the first non-pure tool call; a later budget threshold or explicit multi-stage/waiting plan is a deterministic promotion signal.
- The preflight is capped per side-effect tier, not per Run: at most one preflight per tier (`idempotent` < `queryable` < `non_idempotent`), and the first appearance of a higher tier always re-evaluates even after an `ordinary` verdict at a lower one. Capping per Run would switch the decision off exactly at the first irreversible action. The bound is therefore at most three preflights per Run, and zero or one for almost every request. It returns `mode`, `reason`, `goal`, initial `acceptanceCriteria`, expected waits and side-effect risk, must complete before the triggering tool executes, and its output is a structured runtime event rather than a persisted conversational control message.
- Mid-run promotion absorbs the current Run's already-executed tool calls as completed steps carrying their real receipts, and as `uncertain` steps where a receipt is missing. Promotion never discards and never replays a call that already happened. If absorption fails, the request ends with a visible error instead of continuing as an unmanaged Run.
- If the preflight fails, ordinary low-risk requests continue through the existing Run. A request explicitly identified as multi-day/long-running fails visibly before side effects rather than silently degrading to an unmanaged Run.
- `paused` is a first-class state distinct from `waiting_for_user`, and `partial` is terminal. A user-initiated "continue" from a terminal state creates a new plan version and a new attempt rather than reopening the terminal state.
- Each attempt builds a fresh controlled Agent Context from stored state (goal, constraints, live acceptance criteria, completed-step evidence summaries and safe references, current step input, previous failure reason). The briefing is an index, not the only knowledge source: a read-only evidence reader lets the attempt dereference only its own authorized evidence under bounded output limits. Attempt Sessions are automation-origin and must be filtered out of every conversation-listing surface in the shared query layer.
- Enforce a task-level budget (cumulative tokens, attempt count, lifetime days), a per-owner active-execution concurrency cap, and a per-owner cap on unfinished executions. Budget exhaustion yields `partial` with an explicit reason; the concurrency cap queues rather than drops; the unfinished cap rejects further automatic promotion while still honouring an explicit override. Current usage is visible before it is exhausted.
- Every acceptance criterion binds to a deterministic checker or is marked subjective; subjective criteria return `unproven` without a judge; a task whose required criteria are all subjective cannot auto-complete. Criteria are shown and editable at creation time and record their author and originating plan version.
- Side-effect intents and receipts carry human-checkable references (target, timestamp, content summary, external id). A record that cannot be checked by a person is not an acceptable basis for a blocking question.
- Interruption during `verifying` discards in-flight verification and re-runs it; deterministic criterion results may be reused across the restart, judge results may not. Repeated verification interruption on one plan version escalates to `recovery_required`.
- Once a Run is owned by a Durable Execution, the inbound queue's `recovery_required` row is a trigger only: it may drive scheduling but must not produce its own user-visible interruption notice, list entry or notification.
- Continuation events missed while the service was offline are coalesced per execution and replayed only inside a configured catch-up window; outside it, report the missed continuations and wait for the next window instead of batch-executing side effects.
- Channel-side state-changing controls are capability-driven over one shared idempotent action contract. Interactive platforms use the existing two-phase card update; QQ/Weixin and any other non-interactive platform use explicit reply/command fallbacks with execution id/version disambiguation. Channel adapters never own state transitions.
- Give users a per-request override to force or suppress Durable Execution. V1 does not add a global off switch because the requested product behavior is automatic by default.
- Add a shared execution coordinator above Runner and Channel. It owns activation, attempt claims, step transitions, continuation, waiting states and final verification. Channel code only renders shared notices and forwards user actions.
- Reuse the existing Runner for each bounded attempt. Durable Execution coordinates multiple Runs; it does not replace model routing, Agent Context, compaction, tool budgets, approvals or Subagent execution.
- Record a step intent transaction before invoking a side-effecting tool and record its receipt afterward. The gap between those writes is represented as `uncertain`, never silently retried.
- Extend the shared tool metadata contract with side-effect class, optional idempotency-key support, optional external-state probe and receipt normalizer. Tools without a declaration are treated conservatively as non-idempotent when they mutate external state.
- Because that conservative default combines with a trigger on every non-`pure` tool, the read-only core tools must be declared `pure` in the same slice that ships lazy promotion, not in the final tool-declaration slice. Otherwise undeclared `read`/`grep`/`ls`/search calls make almost every tool-using turn pay a preflight, which is precisely the ordinary-conversation cost regression the release gate measures.
- Keep receipts compact and structured. Large stdout, generated files and traces remain in existing artifact/run-detail stores and are referenced by safe identifiers rather than copied into the task database.
- Treat Subagent work as child steps or attempts of the parent Durable Execution. A Subagent's prose cannot complete the parent criterion without returned evidence.
- Persist decision requests separately from chat messages, including question, allowed options, creation version, answer and answering actor. A reply is applied only to the matching open decision.
- Reuse the existing Approval system unchanged. Durable Execution stores only the approval reference and resulting decision; it does not widen trust or auto-approve actions. A session grant is bound to the current attempt's fresh Agent Context Session and is presented as “本次执行期间允许”; it expires at the attempt boundary and never becomes a task-wide grant. Repeated requests for the same grant are labelled with their repeat count and reported as a metric, because per-attempt expiry trades approval fatigue for scope safety and that fatigue must be visible rather than absorbed.
- Decision requests and approval requests are rendered in the originating UI Session and source Channel, never only in the hidden attempt Session that raised them. A prompt that exists solely inside a list-filtered automation Session is unreachable, and the task deadlocks in `waiting_for_approval` with nothing for the user to act on.
- `queued` is a distinct state for an execution that has a ready next step but no concurrency slot: no lease, no pending decision, no notification, and a visible queue position. Without it, a queued execution renders as “running” and never moves.
- Trigger automatic cross-Run continuation through a Molibot-managed internal Runtime Event referencing the Durable Execution id and expected version. Watched-event JSON and the runtime event system remain the only scheduler path.
- A continuation event is a trigger, not task state. It may be recreated safely; version and lease checks make duplicate triggers no-ops.
- On startup, reconcile old-process attempts before dispatching new work. Completed evidence is retained, active steps become `uncertain`, and only declared safe recovery strategies may proceed automatically.
- Build a task-level verifier registry. Acceptance criteria bind to deterministic evidence checkers where possible; a judge model is optional for subjective criteria and returns `unproven` when unavailable.
- Permit a bounded verify-correct-verify loop under its own attempt and budget limits. Exhaustion produces `partial` or `failed`, never a success-shaped answer.
- Generate all user-facing progress, waiting, partial, failure and completion summaries from structured Durable Execution state. Debug detail remains in run events and must not be injected into later Agent Context.
- Provide shared APIs/actions for list, inspect, pause, resume, cancel, answer decision and retry recovery. Apply owner/Bot/Project authorization at the shared application layer.
- Desktop presentation follows the four surfaces defined in “macOS 桌面端展示”: an in-place transcript card, a third mode of the existing right-hand inspector panel, a sidebar “进行中” group above the conversation list, and a top-chrome badge with macOS notifications for decisions and terminal outcomes. Progress never appends transcript messages, and long-task detail has exactly one host component.
- Desktop presentation follows `DESIGN.md`, existing shadcn-svelte components, semantic styles, fixed action footers where saving is involved, bilingual copy, Light/Dark/System themes and narrow widths. No viewport units inside sibling-sized panes, `minmax()` floors on panel tracks, paired type-scale variables instead of raw px, semantic colour tokens only, and the task inspector must survive a session switch as workspace-level state.
- Retain state until the **execution** reaches a terminal state, not until an attempt does. A failed attempt inside a live execution keeps its evidence, because the evidence reader dereferences exactly those references on the next attempt; retention keyed on attempt terminality would let a later attempt read a dangling reference. Apply configurable age/size retention to terminal executions' attempt details while preserving a compact terminal summary and acceptance outcome.
- Implementation proceeds as one end-to-end vertical slice at a time, each slice ending at a user-visible surface rather than at a store: (1) deterministic activation + persisted task + transcript card and sidebar row; (2) `pure` declarations for the read-only core tools, then lazy-promotion preflight with per-tier caps, absorption of the already-executed prefix and deterministic later escalation; (3) one side-effecting step with a human-checkable receipt + task inspector panel + decision/approval rendering in the originating Session; (4) kill/restart recovery + the recovery prompt and notification; (5) task-level verification + acceptance-criteria UI; (6) budgets, quotas, `queued` and offline catch-up; (7) remaining tool declarations and Channel cards/commands.

## Testing Decisions

- The primary acceptance seam is the highest existing seam: drive tasks through the real Chat HTTP API against a throwaway service and temporary data directory, using the existing golden-set harness patterns. Tests assert externally visible task state, files/SQLite/API state, receipts and user replies rather than internal call order.
- The recovery harness must be able to stop the scratch service at a declared fault point, restart it with the same temporary data directory, and continue through the public API. This seam proves persistence, process ownership, event dispatch, Runner continuation and user-visible status together.
- Fault points are reached by **observation, not by instrumentation**: the harness polls task/step state through the public read API and uses a controllable external fixture for side-effect windows. The fixture records the external mutation and exposes a query endpoint before deliberately withholding the tool response; once the harness observes that external state, it sends `SIGKILL` to Molibot. This deterministically creates “副作用已发生、回执尚未落库” without adding a fault-injection hook, test-only branch or dynamic import seam to service code. Other fault points are killed after their public state becomes observable.
- Two limits of that fixture are part of the harness contract, not incidental detail. First, withholding the response leaves the tool call hanging, so the scenario is only valid if `SIGKILL` lands before the tool's own timeout fires; the harness declares a poll interval and asserts the kill happened inside that window, otherwise the run is a timeout scenario wearing the wrong name. Second, the fixture only covers network-shaped side effects. File-shaped steps get the equivalent treatment by polling the filesystem for the written path and killing once it exists, and any side-effect class that has neither an interceptable transport nor an observable artifact cannot be tested at this seam and must say so explicitly rather than being silently omitted.
- This primary seam is intentionally the one product-level seam for user confirmation. The product owner confirmed the real Chat API plus service restart boundary before implementation began; the local provider fixture now covers that seam and the remaining external/cross-channel matrix stays explicit.
- Add focused state-machine/store tests only for invariants that are difficult to isolate through the product seam: version conflicts, lease ownership, legal transitions, atomic intent/receipt writes, decision idempotency and retention.
- Reuse existing prior art: golden-set state/trace assertions, scratch-service isolation, Agent Context checkpoint tests, persistent inbound queue recovery tests, execution lease recovery tests, Runner receipt guards and cooperative timeout tests.
- A good completion test asserts world state and acceptance evidence. Matching the words “done”, observing a tool name, or inspecting a private helper is insufficient.
- Automatic activation scenarios cover explicit multi-day intent, multi-stage action with waits, risky external side effects, a simple file edit, a single lookup and ordinary conversation. They assert that pure queries and ordinary conversation reach no preflight, a simple non-pure edit reaches at most one preflight but may remain ordinary, **an `ordinary` verdict at the `idempotent` tier does not suppress the preflight at the first `non_idempotent` tool in the same Run**, no tier is evaluated twice, and a later budget/explicit-plan escalation promotes deterministically without a further classifier call. Measure false-positive and false-negative classification separately.
- Mid-run promotion scenarios prove that tool calls already executed in the promoted Run appear as completed steps with their real receipts, that none of them is re-executed, that a receipt-less call becomes `uncertain`, and that a failed absorption ends the request visibly instead of continuing unmanaged.
- Safe-recovery scenarios inject failure before intent, after intent/before side effect, after side effect/before receipt, after receipt, while waiting for approval, while waiting for a user decision, and during final verification. The post-side-effect/pre-receipt case uses the external blocking fixture and proves the mutation exists before `SIGKILL`; the verification case asserts that verification re-runs rather than entering `uncertain`, and that judge results are recomputed while deterministic results may be reused.
- Budget and quota scenarios prove that task-level exhaustion produces `partial` with a stated reason rather than silent continuation, that the concurrency cap queues instead of dropping, and that the unfinished-task cap blocks further automatic promotion while an explicit override still works.
- Offline scenarios prove that continuations missed while the service was down are coalesced, that only those inside the catch-up window run, and that the user-visible state names the reason for the gap.
- Single-notice scenarios prove that one crash produces exactly one user-visible interruption across the queue row and the Durable Execution.
- Session-leakage scenarios prove that attempt Sessions appear in no conversation-listing surface while the originating Session stays intact and linked.
- Evidence-access scenarios prove that an attempt can dereference its own valid evidence, cannot read another execution/owner/Project's references, receives explicit truncation under per-read and cumulative limits, and never receives hidden debug/control records through the evidence reader.
- Approval-scope scenarios prove that an exact pending action executes once and records its receipt, a session grant applies only to the current attempt Session, a fresh later attempt requires a new approval instead of inheriting or widening that grant, the repeat count is surfaced, and — critically — the approval prompt raised inside the hidden attempt Session is reachable from the originating Session and Channel rather than only from the filtered automation Session.
- Concurrency scenarios prove that an execution over the cap enters `queued` with a visible position, holds no lease, raises no notification, and is never rendered as running; and that it acquires a slot in creation order once one frees.
- Storage-invariant scenarios prove that plan revision, step transition and decision answering all fail closed on a stale `version`, that intent and receipt land atomically, and that no state-machine field is read from a JSON column. Rendered Markdown reports are asserted to be write-only exports that no code path reads back.
- Dangling-reference scenarios delete an artifact/run-detail target out from under a live execution and prove that the attempt continues, the UI renders the stored summary with an explicit “unavailable” marker, the step is not marked failed, and startup reconcile flags the reference.
- Retention scenarios prove that a failed attempt's evidence inside a still-active execution remains dereferenceable by the next attempt, and that trimming only applies once the execution itself is terminal.
- Non-idempotent scenarios prove that uncertain sends/publishes/deletes never replay automatically. Queryable scenarios prove that external state is checked before a retry. Idempotent scenarios prove that a stable key prevents duplication.
- Plan revision scenarios prove that completed evidence survives a new plan version, stale continuation events cannot mutate the new version, and cancelled tasks never restart.
- Completion scenarios prove that one successful tool receipt cannot satisfy unrelated acceptance criteria, missing judge capacity produces `unproven`, a task whose required criteria are all subjective never auto-completes, a user-edited criterion survives later plan versions, and only fully evidenced required criteria produce `completed`.
- Cross-channel contract tests prove that shared state transitions are identical while Channel adapters remain presentation-only. Interactive adapter tests cover two-phase card settlement; QQ/Weixin tests cover short-handle text commands, handle stability and per-user uniqueness, the single-pending natural-language shortcut, refusal to guess when several decisions are open, and that a guessed handle from another owner is rejected by shared authorization rather than by handle obscurity. Full fault injection needs one representative Chat surface.
- Release gating reports task success rate, recovery success rate, false-completion rate, duplicate-side-effect rate, activation false-positive/negative rates, human-intervention rate, elapsed time and model/tool cost.
- Release gating additionally reports the **cost and latency regression on ordinary conversation** — added time-to-first-token and added tokens per non-promoted turn, measured against the recorded baseline. Automatic activation that is cheap in classification accuracy but expensive on every ordinary turn is a regression, and without this number it is invisible.
- Initial acceptance requires zero duplicate non-idempotent side effects and zero false `completed` outcomes **across the declared recovery and completion suites**. This is a bound over the enumerated scenarios, not a global claim: where a judge model participates in a criterion, false completion can only be bounded by the suite, so the gate is stated in those terms and the suite's scenario list is part of the release record. Ordinary golden-set results must show no material regression from the recorded baseline.

## Out of Scope

- A general-purpose DAG, BPMN or distributed workflow engine.
- Parallel step dependency scheduling in V1.
- Arbitrary rollback or compensation for external systems that do not provide one.
- Guessing whether an undocumented third-party side effect occurred.
- Email/file/webhook condition triggers and broader proactive-assistant event sources.
- Replacing Runtime Task scheduling, watched-event JSON, approval, Session, Agent Context, Memory or inbound queue storage.
- Turning Mini App Todo records into Durable Executions automatically.
- Migrating historical conversations or Runs into synthetic long tasks.
- Multi-owner collaboration, assignment, comments, due-date planning, resource management or a full project-management product.
- Continuing execution through OS schedulers or an external cloud worker while Molibot is offline.
- Guaranteeing progress when the required local service, credentials, model, external API or user decision remains unavailable.

## Further Notes

- The feature closes the gap between existing bounded recovery and exact semantic continuation. Existing checkpoints and `recovery_required` rows are useful prior art, but they are not themselves an executable plan.
- The safest first release supports a single active attempt per Durable Execution and a linear plan. This is sufficient to prove the hard parts: evidence-backed completion, side-effect-aware recovery and multi-day waiting.
- “Safe Resume Point” is not an integer step index. It is the combination of plan version, step state, evidence, side-effect classification and the recovery action that is currently allowed.
- Automatic detection should be judged as a product classifier, not treated as prompt folklore. Its errors must be visible in eval results, and the user must retain a one-request override.
- This PRD refines the existing planned work item P1-211. It does not change the delivered status of P1-210 bounded recovery.
- `verifying` is kept as a distinct machine state rather than a phase flag, because the coordinator must forbid side-effecting steps while it is active; it is folded into “进行中” only at the presentation layer.
- The lazy-promotion design deliberately accepts one trade-off: a request that needs cross-Run state but touches nothing external until late will spend its early work inside an ordinary Run. That work is absorbed on promotion, so nothing is lost, but the earliest steps carry weaker evidence than steps planned from the start. This is the price of not taxing every ordinary conversation with a classifier call, and it is the trade-off the product owner is being asked to approve.
- Offline behaviour is a product statement, not only an engineering limit: “多日执行” means the task survives days, not that it progresses while the Mac is asleep or the app is closed. Every surface that shows a long task must be able to say which of the two it is currently doing.
- A plan that lives in a Markdown or JSON file is the single most likely way this feature quietly fails: it looks friendlier, it is readable in a diff, and it invites the model to edit it. But the moment the plan is a file the model can rewrite, "已完成步骤不能因计划改写而失去证据" and "模型不能自己宣布完成" stop being enforceable. See [ADR 0004](../adr/0004-per-domain-databases-and-state-representation.md) for the general form of this decision.
- Per-attempt approval expiry and per-tier preflight are the two places where V1 deliberately pays a recurring user cost to keep a safety property. Both are instrumented (repeat-count metric, preflight-count and latency metric) so the cost is measured rather than argued about, and either can be revisited with data.
- Product-owner confirmation received before implementation: the V1 boundary, the `Durable Execution` terminology, the two activation paths (deterministic signal + lazy promotion with per-tier preflight caps) and their trade-off, the database-only state representation with Markdown as export, the per-attempt approval scope with its repeat cost, the task-level budget/quota ceilings, and the real Chat API plus service restart test seam.
