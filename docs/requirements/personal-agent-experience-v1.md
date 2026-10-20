# MoliBot Personal Agent 体验升级 V1 Spec

确认日期：2026-10-09。实施完成：2026-10-10。行为口径复核：2026-10-20。规则表定稿：2026-10-21。

本文是 Personal Agent V1 产品模型、行为规则与验收口径的唯一规范，不替代 Project、Room、Memory 的独立规范。当前能力状态以[能力矩阵](personal-assistant-capability-matrix.md)为准，已有验证证据与限制见[实施记录](../work/progress/personal-agent-desktop-v1/progress.md)。本次定稿只整理规则的组织形式，不新增产品能力，也不将已交付内容重新列为待开发任务。

**文档结构：** Problem Statement 与 Solution 说明产品意图；Implementation Decisions 中的 `PA-*` 规则表是唯一可引用的约束来源；User Stories 表达意图与验收场景，不重复规则文本；Testing Decisions 按规则 ID 引用。界面实现细节遵循 [DESIGN.md](../../DESIGN.md)。

## Problem Statement

Desktop 普通对话原来以 Channel 和历史 Session 为导航中心，用户难以直接辨认或找到自己的助手。创建或使用 Agent 容易被理解为渠道配置工作，而非开始与某个助手交流。

普通 Session 原本不保存独立的 Agent 归属，部分执行配置来自当前渠道绑定。渠道改绑、恢复历史或切换页面时，用户看到的助手与真正执行的身份可能不一致。

用户需要能直接找到助手、立即交流，并确信历史、模型、草稿、审批与获授权记忆始终属于正确的对象。

## Solution

Desktop 以 Agent 为普通聊天的主入口；Session 是 Agent 下的独立对话，Channel 是访问入口，Project 保持独立工作空间。助手的长期连续性来自身份配置和获授权的 Memory，不依赖无限增长的单个对话，也不拼接其他 Session 的完整历史。

| 概念 | 产品含义 |
|---|---|
| Agent | 长期存在、可识别的助手，拥有名称、头像、定位、模型与 Thinking、Skills、工具权限、独立会话集合、私有知识与关联渠道。稳定身份不随名称变化。 |
| Session Agent | 普通 Session 创建时固定的所属 Agent。与当前 Channel 绑定、Room 的 Primary Agent 分别表达。 |
| Default Agent | 用户配置的默认助手，承接 Desktop 全局“新对话”；初始内置身份为 Momo，稳定 ID 为 `default`。 |
| Session | 保存独立历史与执行上下文的对话；普通 Session 有且仅有一个所属 Agent。V1 不引入永久主对话。 |
| Project | 独立工作上下文，不是 Agent 的子级；本次保持现有 Project 与 Project Session 行为。 |
| Channel | Web、macOS、Telegram、飞书、QQ、微信等访问入口。历史显示来源，不同渠道的 Session 不自动合并。 |
| Owner Memory | 按 owner 授权共享的用户事实与偏好；来源于某个 Agent 的私聊，不代表只允许该 Agent 使用。 |
| Agent Private Knowledge | 按稳定身份隔离的 Agent 身份、角色与自身知识，不代表支持单条用户事实的私有保存。 |
| Execution Identity | 一次请求实际使用的 Agent 身份，由准入模式与持久化归属共同决定。它只有 `agentId` 一个值，没有“渠道身份”“Bot 身份”等变体。 |
| Claim | 为未归属历史写入归属的一次性操作。它改变历史的归属分组，不改变任何执行权限。 |

主导航保留全局新对话、自动任务、“我的 Agent”、独立 Project 列表及技能、计划、小程序、消息渠道、Agent Team 等入口。Agent 为一级、Session 为二级，Channel 进入连接管理或高级视图。具体布局可适配窄侧栏，不强制树形结构。

全局“新对话”始终进入默认 Agent；每个 Agent 自己的“＋”进入该 Agent 的新对话。首次发送前可切换 Agent，首次发送才创建并固定 Session 归属。用户无需先配置渠道，也无需每次打开选择窗口。

## User Stories

下列故事表达用户意图与验收场景；可实现的约束以其后 Implementation Decisions 中的规则 ID 为准，映射见附录 A。

1. 作为 Desktop 用户，我希望按助手身份找到 Agent，以便直接选择由谁帮助我。
2. 作为 Desktop 用户，我希望全局新对话始终进入默认 Agent，以便入口行为固定可预期。
3. 作为 Desktop 用户，我希望各 Agent 的“＋”直接打开对应草稿，以便快速开始指定助手的对话。
4. 作为 Desktop 用户，我希望创建 Agent 后无需配置渠道即可聊天，以便立即使用它。
5. 作为 Desktop 用户，我希望首次发送前能看到并切换当前 Agent，以便确认接收者。
6. 作为 Desktop 用户，我希望首次发送才创建 Session，以便打开首页不会产生空历史。
7. 作为 Desktop 用户，我希望点击 Agent 主体打开其首页，点击展开按钮查看历史，以便两种操作互不干扰。
8. 作为 Desktop 用户，我希望首次默认折叠历史并能同时展开多个 Agent，以便管理不同数量的助手。
9. 作为 Desktop 用户，我希望展开状态和上次页面在重启后恢复，以便继续工作。
10. 作为 Desktop 用户，我希望 Agent 与 Session 有各自的选中态，以便辨认当前助手和对话。
11. 作为 Desktop 用户，我希望默认 Agent 置顶并有标记，以便容易找到默认入口。
12. 作为 Desktop 用户，我希望在 Agent 首页看到身份、输入框、最近历史和全部历史入口，以便立即交流。
13. 作为 Desktop 用户，我希望示例任务只填入草稿，以便由我决定是否发送。
14. 作为 Desktop 用户，我希望一个 Agent 能有多个独立 Session，以便分开处理不同话题。
15. 作为 Desktop 用户，我希望打开历史时恢复固定的 Session Agent，以便后续执行身份不变。
16. 作为 Desktop 用户，我希望已有 Session 不能通过 Composer 隐式改归属，以便避免身份混淆。
17. 作为 Desktop 用户，我希望改名不影响 Agent 的历史归属，以便安心调整显示信息。
18. 作为 Desktop 用户，我希望完整历史按 Agent 限定、按更新时间排序并支持检索和分页，以便找到旧对话。
19. 作为 Desktop 用户，我希望保留重命名、归档、删除及归档历史访问，以便整理对话。
20. 作为 Desktop 用户，我希望跨 Agent 搜索最近对话，以便不必先记住它属于谁。
21. 作为 Desktop 用户，我希望历史标明 Channel 来源并区分 Project 与普通 Session，以便理解来源和权限。
22. 作为 Desktop 用户，我希望能只读查看外部渠道历史，以便定位来源而不意外跨渠道续聊。
23. 作为 Desktop 用户，我希望切换 Agent 时保留各自草稿，以便输入不会串到另一位助手。
24. 作为 Desktop 用户，我希望执行中切换页面后，结果与审批仍留在原 Session，以便不误操作其他对话。
25. 作为 Desktop 用户，我希望模型只在 Composer 有一个选择入口，以便理解本 Session 的模型设置。
26. 作为 Desktop 用户，我希望 Session 模型覆盖优先，否则跟随 Agent 当前配置及现有默认继承，以便既能局部调整也能统一管理。
27. 作为 Desktop 用户，我希望聊天与 Agent 管理分离，并能随时使用固定保存栏，以便配置不妨碍日常使用。
28. 作为渠道用户，我希望 Bot 改绑后使用新 Agent 的新 Session，以便不把旧助手上下文交给新身份。
29. 作为历史数据所有者，我希望可按既定 Bot 绑定规则补齐未归属历史，以便已有对话可以被归类。
30. 作为历史数据所有者，我希望没有有效绑定的历史保持只读，直到我显式认领，以便不被任意分配。
31. 作为 Desktop 用户，我希望获授权的普通助手能共享我的事实与偏好，以便减少重复交代。
32. 作为 Desktop 用户，我希望 Agent 私有知识按稳定身份隔离，以便不同助手不会互相冒用角色和知识。
33. 作为 Desktop 用户，我希望关闭 owner 共享后仍能使用本 Agent 的私有记忆，以便两种范围独立控制。
34. 作为 Desktop 用户，我希望 Project 知识与内部业务 Agent 遵守现有权限，以便不会因本次改版扩大授权。
35. 作为 Desktop 用户，我希望系统说明单条用户事实私有保存尚不在 V1 承诺内，以便不误解私聊的隐私含义。
36. 作为 Desktop 用户，我希望长期知识能跨同一 Agent 的 Session 使用，同时不加载其他对话的完整历史，以便兼顾连续性与上下文边界。
37. 作为 Desktop 用户，我希望禁用 Agent 后保留可读历史并阻止新对话、续聊和定时新触发，以便控制助手是否接受新工作。
38. 作为 Desktop 用户，我希望禁用不自动终止已开始运行，既有停止和恢复仍可使用，以便完成必要处理。
39. 作为 Desktop 用户，我希望禁用期间定时任务跳过并记录原因，启用后只按后续计划运行，以便不会突然补跑。
40. 作为 Desktop 用户，我希望删除前看到渠道、任务、运行和审批等阻塞对象，以便明确处理依赖。
41. 作为 Desktop 用户，我希望删除后普通历史归档且可查看、不可续聊，以便保留记录并阻止失效身份执行。
42. 作为 Desktop 用户，我希望删除 Agent 不自动删除私有记忆或项目文件，同名新 Agent 也不继承旧身份，以便数据处理可控。
43. 作为 Desktop 用户，我希望隐藏与禁用分别表达，以便内部 Agent 可运行但不占普通聊天导航。
44. 作为 Desktop 用户，我希望切换中英文、明暗主题、窄窗口或键盘操作时仍能完成相同流程，以便界面适应使用环境。
45. 作为 Desktop 用户，我希望重启和服务中断恢复后保持归属、设置和页面状态，以便不会丢失工作上下文。
46. 作为产品负责人，我希望实现完成与原生、外部渠道、付费 Provider 的验收证据分开报告，以便准确判断剩余风险。

## Implementation Decisions

每条规则一句可判定的话，“失败模式”是可观察到的错误结果，用于写断言。规则 ID 是测试、评审与后续变更的引用锚点，新增行为先加 ID 再实现。

### 共享身份与执行

| ID | 规则 | 失败模式 |
|---|---|---|
| PA-I1 | 普通 Session 在首次发送时固定一个 Session Agent，此后不可变。 | 同一 Session 先后以两个 Agent 执行 |
| PA-I2 | 服务端按持久化归属确定执行身份；请求身份与归属不一致时拒绝，不回退到默认 Agent。 | 错配请求被静默改派给默认 Agent |
| PA-I3 | Bot/Profile 到 Agent 的解析只经唯一接口；空绑定视为 `default`，未知 Bot 视为**未分配**，已删除 Agent 视为拒绝。 | 未知 Bot 的历史被归给 Momo |
| PA-I4 | Agent ID 不可变；改名不影响归属、历史与运行中的执行身份。 | 改名后历史消失或历史被重新归属 |
| PA-I5 | 默认 Agent 的选择只影响新对话入口，不改写既有 Session。 | 换默认 Agent 后旧会话改派 |
| PA-I6 | 归属事实只有一个权威，其余位置是投影；启动核对分歧并报告，不静默修正。 | 同一 Session 在两处显示不同 Agent |
| PA-I7 | 只有身份解析模块可以读取 `settings.channels[*].instances[].agentId`。其他模块只接收结果。 | 新增一处内联空值兜底 |
| PA-I8 | 复用既有 Agent 配置、会话存储、历史查询、Runner 与 Memory 引擎，不创建第二套会话、身份或记忆系统。 | 同一概念出现两套并行实现 |
| PA-I9 | 创建 Agent 不要求先绑定渠道；聊天入口不依赖渠道配置。 | 新建 Agent 后必须先配置渠道才能对话 |
| PA-A1 | 每次请求归入且仅归入一种模式：`new`、`pinned`、`recovery`。模式由同一判定函数产出。 | 同一请求在两个入口被判成不同模式 |
| PA-A2 | `new`：要求 Agent 存在且启用；创建 Session 并固定归属。 | 为新对话建出空历史，或未启用 Agent 接新活 |
| PA-A3 | `pinned`：要求 Agent 存在且启用；归属必须匹配；不得隐式改归属。 | 首次发送后仍可换 Agent |
| PA-A4 | `recovery`：允许 `enabled=false`；必须匹配 `runId` + `userId` + 持久化 origin；不得创建新身份、不得发起新工作、不得延长 retention。 | 借恢复给禁用 Agent 开新轮次 |
| PA-A5 | Agent 删除后不存在 `recovery`；既有停止控制保留。 | 删除后仍有执行被恢复并产生输出 |

#### 准入模式

| | `new` | `pinned` | `recovery` |
|---|---|---|---|
| 触发 | 无 `sessionId` | 有持久化归属的 `sessionId` | 有 `runId` 且匹配挂起/中断记录 |
| Agent 状态 | 必须启用 | 必须启用 | 允许禁用 |
| 归属 | 创建并固定 | 必须匹配 | 必须匹配 origin |
| 可否产生新轮次 | 是 | 是 | 否 |
| 可否改变归属 | 固定为请求 Agent | 否 | 否 |
| 额外前置 | 无 | 无 | `runId` + `userId` + origin 三者一致 |

判定函数返回 `{ agentId, mode, source }`，`source ∈ session | explicit | binding | default`。`source` 只用于排障与 Trace，不参与业务判断；界面不得据此显示第二套身份。

#### 唯一身份接口

```
resolveExecutionIdentity({ channel, botId, sessionId?, explicitAgentId? })
  -> { agentId, mode, source }
```

- 唯一读取渠道/Profile 绑定的地方；唯一做空值归一的地方。
- 三种绑定语义必须分开，不得合并为一个空值兜底：
  - **已配置 Bot，绑定为空** → `default`（Momo 归一）
  - **Bot 不存在** → 未分配（只读，等待认领）
  - **绑定到已删除 Agent** → 拒绝，不回退
- `global` 是共享配置作用域，不是 Agent 身份；任何把它当作 Agent ID 的路径都属于实现错误。
- 所有入口（Web、Desktop、渠道、自动任务、历史补齐、Trace、活动状态）调用它，不自行推导。
- 客户端不解析身份：不出现 `agent-<id>` 这类靠字符串前缀还原身份的伪对象；服务端为每个 Session 与草稿目标返回 `agentId`。

**机器守卫：** 一条源码守卫测试，断言除身份解析模块外没有代码直接读取 `channels[*].instances[*].agentId`。新增分发路径时先失败。

#### 归属权威与投影

归属事实在三个位置出现：Session 元数据、Agent Context origin、会话目录分区。

- **权威**：首次发送时写下的 Agent Context origin。
- **投影**：Session 元数据与历史列表读取的 `agentId`，由同一次准入结果写入。
- **核对**：启动时比对投影与权威，发现分歧只报告（进入结构化诊断），不自动改写。
- 三个位置都不得单独成为第二套判断依据；执行路径只信权威，列表路径只信投影，两者不一致时以诊断暴露。

#### 模型优先级

Session 显式覆盖 > Agent 当前配置 > 全局默认模型。Agent 或其模型在后续被禁用时，Session 回落到全局默认并在 Composer 标明。配置变更影响后续轮次，不改写历史消息，也不改变归属。

### Desktop 交互与保存

| ID | 规则 | 失败模式 |
|---|---|---|
| PA-U1 | 全局新对话进入默认 Agent；每个 Agent 的“＋”进入该 Agent 的草稿；默认 Agent 置顶并标记。 | 入口落错 Agent；默认入口难以辨认 |
| PA-U2 | 首次发送才创建 Session；首次发送前可切换 Agent；已有 Session 不能经 Composer 改归属。 | 打开首页产生空历史；或旧会话被改派 |
| PA-U3 | Agent 主体、历史展开按钮、具体 Session 分别承接首页、展开、续聊；Agent 与 Session 选中态独立；多组可同时展开，首次折叠，展开与上次页面跨重启恢复。 | 点击主体误开历史；重启后回到错误的 Agent |
| PA-U4 | 草稿按 Agent 隔离；切页不改变原运行、结果、文件与审批的归属。 | 两个 Agent 的草稿串写；后台结果覆盖当前页 |
| PA-U5 | 模型只在 Composer 有一个入口；优先级按“模型优先级”执行。 | 同一 Session 出现两个模型来源，或改配置改写历史 |
| PA-U6 | 聊天与 Agent 管理分离；保存操作在固定底栏；保存按实体或动态 key 细粒度提交。 | 保存丢其他 Agent 或渠道字段 |
| PA-U7 | 中英即时切换、明暗主题、窄窗口与键盘操作下流程一致可完成。 | 窄窗或切语言后按钮不可达 |
| PA-U8 | 示例任务与“最近历史”只填充草稿或负责导航，不自动发送。 | 打开首页即触发执行 |

桌面数据以服务端为唯一身份来源：

- Agent 首页的最近历史、历史分页、未分配计数使用按 Agent 限定的服务端查询，不在客户端对全量列表切片。
- 排序（默认 Agent 置顶）与“是否可执行”由服务端给出，客户端不重复实现。
- 草稿的归属目标是显式的 `agentId` 字段，不是从 profile ID 反解。
- 外部 Session 若缺少归属，界面显示“未分配”，不回退到当前选中的 Agent。

### 渠道与历史归属

| ID | 规则 | 失败模式 |
|---|---|---|
| PA-C1 | Bot 从 A 改绑到 B 后，旧 Session 仍属 A；新消息创建或进入 B 的新 Session。 | 新身份接着旧 Agent 的上下文聊 |
| PA-C2 | 未归属旧历史按 Bot 目录与有效绑定补齐归属；已有归属优先且不可改写；Project 与自动任务不参与；不搬动或重写正文。 | 补齐覆盖了已有归属；或重写聊天记录 |
| PA-C3 | 外部渠道 Session 在 Desktop 只读；认领不解除该限制。 | Desktop 能对外部 Session 发起执行 |
| PA-H1 | Agent 历史按 Agent 限定，按更新时间排序，支持检索与分页；标明 Channel 来源并区分 Project 与普通 Session；支持跨 Agent 的最近对话搜索；包含外部渠道 Session（只读）。 | 历史串到别的 Agent，或分页丢项，或分不清来源 |
| PA-H2 | 未归属历史只读，直到用户显式认领；认领写入归属，但不解除只读。 | 刷新后认领失效，或认领后可跨渠道续聊 |
| PA-H3 | 认领不得改写已有归属；重复认领幂等。 | 认领把已有归属的 Session 抢走 |
| PA-H4 | Room 对话属于 Room，不属于任何 Session Agent；它不出现在 Agent 历史里，只在 Agent Team 中呈现。 | Room 对话同时出现在两处，或两处都不出现 |
| PA-H5 | Project Session 保持现有行为，不参与 Agent 归属、删除归档与认领。 | 删除 Agent 时 Project 会话被归档 |

Room 归属的落地口径：

- 不出现在 Agent 历史、Agent 首页“最近历史”或 Agent 删除归档范围内。
- 只在 Agent Team 中呈现；若某处需要汇总，只能以只读引用形式出现，且必须标明来源是 Room。
- Room 的 Primary Agent 与 Session Agent 是两件事，互不推导。

认领必须产生一个可观察结果，否则不构成产品能力：

- 认领写入归属元数据，一次生效，重启后保持。
- 可观察结果：该历史从“未分配”分组移入目标 Agent 的历史列表；标记保留“外部来源”与“只读”。
- 不改变：执行权限、可续聊性、其他 Session 的归属。
- 重复认领幂等；目标与已有归属不一致时拒绝，不覆盖。

既有 Telegram、飞书、QQ、微信的收发与映射能力保留。独立 Web 不改版，也不新增认领控件。

### 记忆与上下文

| ID | 规则 | 失败模式 |
|---|---|---|
| PA-M1 | 同一 owner 的普通助手按授权共享用户事实与偏好；关闭 owner 共享后，本 Agent 私有记忆仍可用。 | 关闭共享后私有记忆也读不到 |
| PA-M2 | Agent 私有知识按稳定 ID 隔离；`agent:` 命名空间只能由 Agent 身份产生。 | 两个 Agent 互相读到人设 |
| PA-M3 | 不得以 Channel 或 Bot 代替 Agent 身份；没有 Agent 身份的范围不得产生 `agent:` 命名空间。 | 以 `agent:<botId>` 写入或读取 |
| PA-M4 | 写入、反思、检索与最终模型注入使用同一个范围构造器。 | 写入在 owner，注入在 agent，同一事实两处不一致 |
| PA-M5 | 已删除 Agent 的私有记忆不再注入、不可被其他 Agent 检索、不转交给默认 Agent；删除记忆需单独操作。 | 删除后仍被注入提示词 |
| PA-M6 | 不新增 Memory 引擎；不承诺单条用户事实的 Agent 私有保存；不宣称未测量的 token 节省比例。 | 文档或界面宣称了未实现的能力 |
| PA-M7 | 同一 Agent 跨 Session 可访问获授权的长期知识，但单次请求不加载其他 Session 的完整历史；长历史沿用现有 Compaction。 | 请求上下文随历史数量线性增长 |

记忆范围建模为判别联合：

```
MemoryScope =
  | { kind: "agent"; agentId: string; ownerId: string; shareOwner?: boolean; projectId?: string }
  | { kind: "project"; projectId: string; ownerId: string; agentId?: string }
  | { kind: "channel"; botId: string; ownerId: string; channel: string; chatId: string }
```

- `agent:` 命名空间只能由 `kind: "agent"` 产生；`kind: "channel"` 只能产生 `chat:` 与 `owner:`。
- 授权检查对每个分支都必须给出结论，不存在“缺少 agentId 就原样放行”的路径。
- `shareOwner` 只在 agent 分支影响命名空间集合，且该值以配置为准，不由调用方传入决定。
- Project 知识继续遵守项目作用域与权限。内部业务 Agent 不因本次变化扩大授权。
- 私聊不增加授权范围，敏感内容仍受既有授权与 turn-retention 约束。

### 生命周期

| ID | 规则 | 失败模式 |
|---|---|---|
| PA-L1 | 默认 Agent 必须存在且启用；禁用或删除前必须先指定有效替代。 | 默认 Agent 被删后全局新对话不可用 |
| PA-L2 | 禁用：历史默认折叠但可展开；阻止 `new`、`pinned` 与自动任务新触发；不自动停止已开始运行。 | 禁用后运行被中途杀掉，或仍能开新对话 |
| PA-L3 | 禁用期间定时任务跳过并记录原因；启用后只执行后续计划，不补跑。 | 启用瞬间补跑一批过期任务 |
| PA-L4 | 删除前必须 `blockers(agentId) = []`。blocker 以结构化对象返回，类型至少覆盖：渠道绑定、定时任务、非终态运行、待审批、Host Bash 审批、非终态 Durable Execution。 | 删除被一句拼接字符串挡住，界面无法列出对象 |
| PA-L5 | 删除是 `active → deleting → deleted` 的三态过程，顺序固定为 blockers → archive → tombstone。`deleting` 必须持久化，期间该 Agent 的 `new` 与 `pinned` 拒绝。archive 失败保持 `deleting` 并可重试；删除与归档均幂等。 | Agent 已删、历史未归档、只能靠巧合重试；或删除过程中仍接新活；或重启后回到误判状态 |
| PA-L6 | 删除后：历史只读、不可续聊；私有记忆保留但不注入、不可检索、不转交默认 Agent；同名新 Agent 不继承旧身份或旧知识。 | 新建同名 Agent 读到了旧助手的人设 |
| PA-L7 | 可见性与启用独立：隐藏只影响普通聊天导航，不影响执行与定时任务。 | 隐藏 Agent 后定时任务停止，或隐藏等同于禁用 |

阻塞对象与删除流程：

```
AgentBlocker =
  | { kind: "channel"; channel: string; instanceId: string }
  | { kind: "task"; file: string; title?: string }
  | { kind: "run"; sessionId: string; runId: string }
  | { kind: "approval"; requestId: string; sessionId: string }
  | { kind: "host-approval"; requestId: string; sessionId: string }
  | { kind: "durable"; sessionId: string; executionId: string }
```

1. `active`：`blockers(agentId)` → 非空则拒绝，并原样返回列表供界面渲染“需处理对象”。
2. `deleting`：写入持久标记（与 `deletedAgentIds` 同一动态 key，如 `pendingAgentDeletions`），该 Agent 的 `new` 与 `pinned` 立即拒绝；已开始的运行不受影响。归档本次覆盖的普通 Session；外部 Session 只写生命周期行，不启用镜像写入。
3. `deleted`：同一次写入中写 tombstone（`deletedAgentIds`）、移除 Agent 配置并清除 `deleting` 标记。

第 1 步失败不改变状态；第 2、3 步失败停留在 `deleting`，重启后从该状态继续，重试从头开始仍安全。`deleting` 必须持久化，否则进程重启后会重新接受新工作；归档失败不得留下“已删除但历史未归档”的终态。

恢复与停止：禁用 Agent 时保留既有停止和恢复控制；恢复须校验原运行与所属身份，不能借恢复创建新身份的运行。禁用期间定时任务跳过并记录原因；重新启用后只执行后续计划，不补跑。

## Testing Decisions

### 主要测试入口与判定标准

- 继续使用已确认的共享会话服务与真实 Runner 集成链路，作为身份与业务行为的主要测试入口。不为每个面板建立业务测试接口；仅在记忆、持久化和真实界面需要独立证据时使用既有专项入口。
- 使用临时数据库、隔离数据目录与本地模拟模型；HTTP handler、Runner、工具、审批和存储使用真实生产实现。测试不读写用户数据，不中断用户服务，不使用真实 Provider 或第三方账号。
- 好的测试断言外部行为：界面反馈、API 业务状态、实际执行结果、持久化归属与副作用。不能仅凭模型文字宣称成功，也不绑定私有 helper、CSS 层级或组件源码文本。
- 既有普通 Session 身份／历史关联／真实 Runner 回归、Personal Agent 设置 round-trip、Memory Gateway 端到端与命名空间授权、Desktop 行为和 Agent 设置 UI 用例是测试先例；优先扩充这些测试，不另建并行框架。

### 三层测试与覆盖清单

| 层 | 入口 | 用途 |
|---|---|---|
| 行为测试 | 共享会话服务 + 真实 Runner 集成链路 | 用户可见结果：界面反馈、API 业务状态、实际执行、持久化归属 |
| 契约测试 | 规则表中被多个调用方共用的接口（身份解析、范围构造、blockers） | 锁住“同一条规则只有一个实现”：一张表驱动所有入口与模式 |
| 守卫测试 | 源码结构 | 禁止绕过唯一接口：直接读绑定、直接拼 `agent:` 命名空间、删除中重新接活 |

必须覆盖（引用规则 ID）：

1. PA-I1、PA-I2、PA-I4、PA-I9、PA-A2、PA-A3：创建 Agent，无渠道直接发送，重启后续聊；错配被拒；改名不改归属。
2. PA-U1、PA-U2、PA-U8、PA-I5：全局新对话进默认 Agent；各 Agent “＋”进对应草稿；发送前可换，发送后不可换；换默认 Agent 不改写旧会话；示例任务不自动发送。
3. PA-U3、PA-U4：三种点击各司其职；多组展开、上次页面、超出最近列表的 Session 重启后恢复；两 Agent 草稿隔离。
4. PA-A2、PA-U5：Session 覆盖、Agent 配置、全局默认按序生效；真实请求携带正确身份与模型。
5. PA-C1、PA-C2、PA-I3、PA-H1、PA-H2、PA-H3：改绑进新 Session；补齐重复执行稳定；未知 Bot 保持未分配；历史分页与来源标注；认领落盘且重启后保持。
6. PA-M1 至 PA-M4：owner 共享、关闭后私有可用、Agent 隔离、跨 Session 注入；检查最终真实系统提示词；写入与注入范围一致。
7. PA-L6、PA-M5：删除后私有记忆不可检索、不可注入；同名新 Agent 不继承。
8. PA-L1、PA-L2、PA-L4、PA-L5、PA-L7：默认 Agent 约束、禁用后拒绝新工作、blockers 覆盖六类对象、删除三态顺序与重启后重试、隐藏不等于禁用。
9. PA-L3、PA-A4、PA-A5：定时任务禁用跳过并记录原因、启用不补跑；禁用 Agent 的既有运行可停止、可恢复，且恢复不产生新轮次；删除后不存在恢复。
10. PA-I6：投影与权威分歧能被诊断发现，且不被静默改写。
11. PA-H4、PA-H5、PA-C3：Room 对话不进入 Agent 历史；Project 会话不参与归档与认领；外部 Session 在 Desktop 保持只读。
12. PA-U7：中英即时切换、明暗、窄窗、键盘焦点。
13. PA-U6：设置字段用临时数据库做 save → 新建 store → load 整对象 round-trip；固定底栏在窄窗内可达。
14. PA-M7 负向：单次请求不加载其他 Session 完整历史；历史数量增长不导致上下文线性增长。
15. PA-I8 守卫：同一概念不存在第二套实现（身份、会话存储、历史查询、记忆引擎）。

分层覆盖说明：契约测试覆盖 PA-A1、PA-I3、PA-I7、PA-M4、PA-L4；守卫测试覆盖 PA-I7、PA-I8、PA-M3；PA-M6 由发布检查覆盖（文档与界面不得宣称未实现能力）。

### 执行与证据边界

- 涉及行为实现或修复时，运行直接相关的现有检查；新增用例覆盖成功及失败／边界，断言反馈、状态和实际结果。修复用例证明故障时失败、修复后通过；新用例连续五次通过后纳入测试集。
- UI 实现改动需相关行为测试、Svelte 类型检查、构建和隔离冷路径：重启服务、首次打开受影响页面、切换 Session／页面、服务中断后恢复。原生链路改动增加对应原生检查；浏览器预览不能替代原生 App 验收。
- 日常只运行直接相关验证。全量验收命令 `pnpm verify:feature` 留给用户主动执行；真实外部渠道与付费 Provider 验证需要明确授权。环境缺失的必需检查报告为未验证，不计为通过。
- 本次定稿只改文档：检查规则 ID 的引用完整性、术语一致性、链接与需求保留情况，不运行未改动产品的测试或构建。
- 既有证据包括隔离 Desktop 浏览器预览、自动测试及 Rust 测试。本 V1 的完整原生 macOS 人工走查、外部真实渠道和付费 Provider 在线验收尚未完成；实施完成不表示这些路径全部验收通过。

## Out of Scope

- 独立 Web 界面改版；Project／Project Session 的 Agent 绑定、选择或身份恢复；Agent Room 重设计。
- 永久主对话、跨 Session 完整上下文合并、跨 Channel 无缝续聊、多 Agent 自动协作与 `@Agent`。
- 新任务中心、Activity Feed、复杂 Agent Dashboard、新 Memory 引擎和底层 Session 存储大规模重构。
- 旧历史存储搬迁或正文重写、兼容层、默认身份 fallback 与推测性配置；按既定规则补齐归属元数据不在此排除项内。
- 删除 Agent 时自动删除私有记忆或项目文件。
- 单条用户事实的 Agent 私有保存、敏感内容自动识别与作用域切换；不得将现有 Agent 自身事实工具宣称为这些能力。
- 授权事项的持续跟进、记忆的用户可见与可编辑、跨渠道连续性和 Agent 人设影响的专门评测。这些是独立需求，不能因本 Spec 发布而自动批准排期。
- 本次文档定稿不实施代码、部署、迁移用户数据或补跑真实账号／付费验收。
- 不新增与本规范并行的第二份 Personal Agent 规范。
- 不把执行身份解析分散到 Channel 层。

## Further Notes

- Issue tracker：[GitHub Issue #66](https://github.com/gusibi/molibot/issues/66)，标签 `ready-for-agent`。Issue 保存本次 Spec 的发布快照；后续规范更新以本文为准，发布标签不将已交付内容重新变成开发任务。
- 2026-10-20 确认：全局新对话始终进入默认 Agent；用户事实维持现有 owner 授权共享，明确私聊与 Agent 私有知识的区别。
- 2026-10-21 定稿：规则收敛为可引用的 `PA-*` 编号；新增唯一身份接口、准入三模式、删除三态、记忆范围判别联合、认领落盘与 Room 归属口径。以下三项按“不改变已交付行为”的口径定稿，均可单点回退：
  - 模型优先级第三档为全局默认模型；Agent 被禁用时回落并在 Composer 标明。
  - 归属权威为 Agent Context origin，Session 元数据为投影，启动核对只报告不修复。
  - Room 对话不进入 Agent 历史，只在 Agent Team 呈现。
- 本版规则中尚未实施、且不属于此前已交付范围的有：PA-I6 的启动核对、PA-U 的客户端身份收口。其余规则（PA-I3／I7、PA-A1、PA-L4／L5、PA-M3／M4、PA-H2／H3）已于 2026-10-21 实施并有定向用例。能力状态仍以能力矩阵为准，逐项完成后在同一个 slice 更新矩阵与实施记录。
- 本版规则不证明所有条款已经获得新的实现或验收证据；交付状态、已实施范围与具体限制仍查能力矩阵及实施记录。
- 本文原地替代原 PRD 的组织形式，保持原链接，不恢复已删除的平行 Desktop Spec，也不另建一份竞争规范。Project、Room 和 Memory 的独立规范继续有效。
- 领域术语沿用[领域词汇表](../reference/CONTEXT.md)；记忆默认作用域与删除／保留语义遵循[ADR 0001](../adr/0001-memory-namespace-and-turn-retention.md)；界面实现遵循[设计规范](../../DESIGN.md)。

## 附录 A · 故事到规则的映射

| 故事 | 规则 |
|---|---|
| 1–5 | PA-U1、PA-U2、PA-I9 |
| 6–12 | PA-U2、PA-U3、PA-U8 |
| 13–20 | PA-U8、PA-I1、PA-A3、PA-I4、PA-H1、PA-U6 |
| 21–23 | PA-H1、PA-C3、PA-U4 |
| 24–27 | PA-U4、PA-U5、PA-U6 |
| 28–30 | PA-C1、PA-C2、PA-H2、PA-H3 |
| 31–36 | PA-M1、PA-M2、PA-M6、PA-M7 |
| 37–39 | PA-L2、PA-L3 |
| 40–42 | PA-L4、PA-L5、PA-L6 |
| 43 | PA-L7 |
| 44 | PA-U7 |
| 45 | PA-I6、PA-U3 |
| 46 | Testing Decisions |

## 附录 B · 定稿时的实现缺口

本节是 2026-10-21 定稿时对当前实现的快照，供实施定位使用；**每项落地后删除对应行**，不作为长期规范。

| 规则 | 定稿时现状 | 落点 |
|---|---|---|
| PA-I6 | 两个身份载体各自不可变，无启动核对 | `sessions/store.ts`、`agent/session/metadata.ts` |
| PA-U | Agent 首页由客户端从全量列表切片；`agent-<id>` 靠字符串前缀还原身份 | `apps/desktop/src/ChatView.svelte`、`apps/desktop/src/lib/chat` |

2026-10-21 已实施并从本表移除：PA-I3／I7（唯一身份解析与源码守卫）、PA-A1（准入模式判定）、PA-L4／L5（结构化 blockers 与删除三态）、PA-M3／M4（记忆范围判别、去 Bot 回退）、PA-H2／H3（认领落盘）。PA-H4 的过滤行为已在代码中，但仍缺显式断言。

建议实施顺序（非约束）：身份接口与守卫（PA-I3／I7）→ 准入模式（PA-A1–A5）→ 删除 blockers 与三态（PA-L4／L5）→ 记忆范围（PA-M3／M4）→ 认领（PA-H2／H3）→ 客户端收口（PA-U）→ 权威核对（PA-I6）。
