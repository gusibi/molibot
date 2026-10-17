## 2026-10-16 — Agent 设置保存后停留

- 保存 Agent 设置后保留当前页面与分类，并显示成功提示；点击返回时再离开设置页。

## 2026-10-16 — 技能详情就地展开

- 点击技能卡片就地展开详情：卡片网格展开成竖向列表，右侧同时显示技能内容与完整目录。
- 详情包含 SKILL.md 路径、YAML 元信息、版本与修改时间；目录里的文本文件可直接预览。
- 技能页改为全宽内容区，与自动任务、计划一致。
- 移除原有的居中详情弹窗。

## 2026-10-16 — 技能管理入口合并

- 技能管理统一到外侧技能页面，沿用现有卡片；设置里的 Skills 只保留搜索配置。
- 修正内置技能关联，支持安装、更新和保留备份后覆盖修改；自动备份不再作为技能加载。
- 侧栏技能入口移至计划下方。

## 2026-10-16 — 计划操作与返工

- 计划状态直接点击筛选，详情操作移到上方。返工可取消，未填写完整的任务会阻止继续新增和保存；修复返工保存缺少作者信息导致的失败。

## 2026-10-16 — 工作区顶部信息

- 自动任务和计划补齐顶部说明。小程序数量靠左、管理入口位于同一行右侧。

## 2026-10-15 — 桌面工作区布局统一

- 自动任务和计划采用 320px 固定列表与详情，未选中时显示启动页风格插画；窄窗可返回列表。
- 四页保持独立导航；标题栏操作统一为图标，搜索点击展开、刷新直接显示；分类和数量位于下方，技能筛选直接点击分段按钮。
- 选中态、文字层级和控件适配现有主题，任务启停与最近运行结果分别展示。

## 2026-10-15 — 强制迁移 Agent 数据

- 迁移弹窗新增“强制迁移（跳过异常项）”，统一跳过异常数据并迁移其余内容，避免逐项排错才能启动。
- 异常源文件与运行记录保留备份，完成后可查看跳过原因和备份位置；跳过的任务不再自动恢复，重启后不再重复拦截。

## 2026-10-14 — Feature 验证自动化

- 新增隔离的 Molibot 实例与预设回复模型服务：临时数据目录/HOME、回环模型、环境变量白名单和启动前守卫，测试不碰真实数据与凭据。
- 浏览器 UI 覆盖聊天、审批（含重复点击与切换会话）、Stop（生成/工具/待审批）、请求失败、队列与插话、排队时审批、设置字段 round-trip、会话切换与服务恢复；断言同时看界面、API 状态和磁盘结果。
- `pnpm verify:feature` 按改动自动选择并运行验证，失败保留截图、操作轨迹、日志与模型请求记录；原生 App 测试尚未建设，明确记为未验证。
- P0「生成中刷新接续回复」暂不可用：现有 `reconnect()` 按设计中止孤儿运行，需先做运行态重新订阅的产品决策。

## 2026-10-14

### Fixed: 聊天正文中的本地图片

- Desktop 聊天正文中的生成图片通过受控附件加载，不再把磁盘路径当作页面 URL。加载完成后自动显示。正文图片使用保持原比例的有限尺寸预览，点击可放大查看。

## 2026-10-13 — 修复模型与扩展调用可靠性

- 修复扩展直接等待流结果时提前返回空值的问题。
- 参考图超限时停止下载，并校验内联图片大小。
- 修复不同扩展事件误用同一调用身份导致的结果复用和费用漏记。
- MCP 调用超时后，追加授权不再重发已结束请求。
- 修复原生桌面的共享规则加载和保存，服务重启后保留内容。

## 2026-10-13 — 补齐 Pi 运行能力

- 渠道任务恢复核对可继续原执行，Web 显示专用核对说明。
- MCP OAuth 支持 Web 部署回调及追加授权，桌面授权状态在语言切换和重启后正确刷新。
- Codemode 与扩展模型调用接入原生任务、审批、预算、媒体记录和持久结果，避免恢复时重复请求及用量漏记。
- 扩展命令、取消、嵌套工具进度和显式压缩绑定原会话；拒绝已结束调用的迟到结果。

## 2026-10-12 — Codemode 大图引用可定位；修复大结果丢失

- Codemode 脚本展示超大生成图片时，引用带上可直接打开的工作区相对路径，不再只是「已保存到制品」。
- 修复生成图制品路径指向不存在文件的问题，以及大结果经子进程回传时可能整体丢失的问题。

## 2026-10-12 — 修复 Room 恢复核对续跑

- 修复 Room 执行在「等待核对」批准后续跑失败的问题：恢复执行以同一 id 重新进入 runner 时，执行到运行映射的写入不再撞唯一约束，改为幂等写入。
- 补上恢复核对运行时装线端到端回归：真实 Room + 重启 + 审批，覆盖批准续跑（恰好重发一次、不重复）与拒绝结束两种情况，并验证人工决定前不会自动重发。

## 2026-10-12 — Room 核对接入审批

- Room 执行遇到「重启前结果未知」时的核对改为走统一的审批卡：批准后继续原执行（未知调用按中断结算、不重放），拒绝或过期则结束该执行。

## 2026-10-12 — Codemode 大图不再灌爆上下文

- Codemode 脚本展示生成的图片时，过大的图片不再内联 base64，改为工作区制品引用，避免一次脚本把模型上下文撑爆。

## 2026-10-12 — 等待核对审批文案

- 桌面「等待核对」审批使用专用标题与说明，讲清这是重启前结果未知的外部操作，批准即按已中断处理并继续剩余工作（不重放）。

## 2026-10-11 — Pi 扩展可读真实运行状态并调用嵌套工具

- 通过真实扩展子进程加载的扩展现在能读到真实的当前模型、思考等级、可用模型范围、上下文用量、系统提示与是否空闲/有待处理消息。
- 扩展可通过 `ctx.executeTool()` 嵌套调用工具，且与模型走同一套权限、审批与预算；未知工具或失败以错误结果返回，不会静默成功。
- 扩展可通过 `ctx.modelRegistry` 发现模型并调用分类与图片生成，同样计入权限、预算与用量；凭据与 Provider 注册不对外暴露。
- 扩展可流式调用 chat 模型（`stream`/`streamSimple`/`complete`），事件按序回传、支持取消，超大分片会终止该流。
- 扩展可只读查看当前执行的会话（身份、记录、分支、上下文投影），来自原生日志、只读且不含凭据。
- 扩展可列出可调用的工具（`ctx.tools`）并中止当前运行（`ctx.abort()`）；扩展忽略取消时会被安全终止，不影响服务。
- 扩展可触发压缩（`ctx.compact()`）；事件处理器也能读到真实运行上下文并调用嵌套工具。
- 尚未接线的会话快照、模型注册表、中止/压缩等接口会明确报错，不再静默返回空值或伪造成功。

## 2026-10-11 — MCP OAuth 端到端打通

- 用本地授权服务器与本地 HTTP MCP 服务验证完整 OAuth 链路：登录、PKCE、state/issuer 校验、刷新、追加授权提示、退出与重启。
- 修复授权码交换丢失配置的元数据地址、以及已结束的登录尝试挡住退出/删除的根因；登录成功后当前会话可重新发现工具。
- 桌面设置补齐 OAuth：可选择认证方式并配置元数据地址，查看授权状态并在系统浏览器完成登录、重新授权与退出。
- 重新授权会保留此前已授予的额外权限，不再回退到只请求默认范围。

## 2026-10-11 — 修复 Agent 运行状态归属

- 运行状态跟随实际执行的 Agent，避免其他 Agent 工作时误标 Momo。
- 侧栏状态改为图标；执行中有轻微呼吸动画，支持减少动态效果。

## 2026-10-11 — MCP 执行恢复与超时设置

- 修复 `mcpInvoke` 与内部工具互相等待执行锁，导致会话长时间卡住的问题。
- MCP 可按服务设置单次工具超时，默认 120 秒；Desktop 表单使用秒，Web JSON 使用 `timeoutMs` 毫秒。设置重启后保留，进度通知不会延长超时。

## 2026-10-11 — 修复共享 Agent 规则作用域

- 设置提供真正的共享规则编辑，所有 Agent 都读取，专属规则继续叠加。
- 模型和身份等明确配置优先于共享默认；Momo 的共享规则避免重复注入。

## 2026-10-11 — 设置页布局与阅读层级优化

- 统一导航选中态、标题与表单对齐、设置组间距和说明排版。
- Agent 编辑改用横向分类，头像预设按需展开；窄窗口下拉和开关布局更清楚，保存栏保持固定。

## 2026-10-11 — 整理 Agent 设置入口

- Agent 页面将全局选项放在列表上方；编辑作为设置二级页面，保留最左侧设置导航和明确的返回入口。
- 专属记忆与已授权共享记忆分开展示，机器人列表只显示当前 Agent 的绑定。

## 2026-10-11 — 明确 Agent 机器人绑定

- “消息渠道”改为“绑定的机器人”，仅展示当前 Agent 的绑定，使用明确的绑定与移交操作代替开关。
- 改绑显示原负责人和待保存变更，支持撤销，避免与机器人启用状态混淆。

## 2026-10-11 — Agent 首页输入框精简与会话右键菜单补齐

- Agent 首页输入框不再显示 Agent 选择器：切换 Agent 统一走侧栏列表；会话内仅保留只读 Bot 徽标。
- Agent 首页最近对话、全部对话与搜索浏览的会话行右键菜单恢复为三项：复制 session 路径、从 Finder 打开、删除对话。

## 2026-10-11 — Agent 专属配置与文件卡片

- 全局 Agent 设置与单 Agent 专属技能、记忆范围明确区分，继承技能默认收起。
- 文件与附件采用带缩略图的卡片，按来源和类型分组，组内最新在前，展示渠道和完整时间。

## 2026-10-11 — 普通任务恢复收尾

- 恢复矩阵补齐三个窗口的真实强杀验证：中断在“尚未开始外部操作”“外部操作已发生但结果未提交”“结果已提交但未展示”。已提交的操作重启后只执行一次；结果未知的操作不会自动重跑。
- 结果未知的外部操作现在可在审批卡片中核对：批准后原任务继续（已确认的未知操作按中断处理、不重跑），拒绝则放弃原任务。

## 2026-10-11 — 普通任务恢复补全

- 重启后，被中断的安全读取（读文件、搜索、网页读取等）会自动从原生断点继续，不再一律要求人工核对；写入、命令和外部操作仍会保守地停下。
- 遇到结果未知的外部操作时，原任务会显示为「等待核对」这一独立状态，而不是直接失败，用户可通过停止来清除。

## 2026-10-11 — Codemode 模型 API（部分交付）

- Codemode 脚本可在一次受控执行里发现可用分类与图片模型、调用分类、生成图片并用 `image()` 直接展示，组合工具与模型工作。
- 脚本中的模型调用使用用户已有 Provider 凭据，受权限、预算与用量合计约束；Plan 或只读下不可用。

## 2026-10-11 — MCP OAuth 授权（部分交付）

- MCP 服务器可显式选择手动 headers 或 OAuth；选择 OAuth 后在设置页完成登录、重新授权与退出，过期令牌自动刷新，追加授权保留已授予的权限。
- OAuth 凭据按服务器身份隔离存入本机受保护文件，同一 URL 的不同配置可使用不同账号；退出与删除服务器只影响该服务器自身的授权。

## 2026-10-11 — 普通任务重启后按原生断点恢复（部分交付）

- 服务重启不再只恢复带 Deferred handle 的任务：普通任务、内部子任务在原生 `prepare`/`retry`/`poll`/`tools` 等安全断点会继续，保留原 Session、Agent、Project、渠道发送目标与原预算，不重发原用户输入。
- 中断的模型请求和不可安全重放的外部写操作不再被笼统重发：检查到未提交的远端请求或外部操作时明确暂停并说明原因，避免重复发送或重复扣费。
- 重启后重新投影已提交答案时不再向对话二次追加，同一结果只显示一次。

## 2026-10-11 — 全局配置文件迁入 agents/default

- 全局 profile 层（AGENTS.md、SOUL.md、IDENTITY.md、USER.md、TOOLS.md、BOOTSTRAP.md）统一存放于 `~/.molibot/agents/default/`，数据目录根下不再散落 profile 文件；Momo 作为全局默认身份，其 Agent 目录即全局基线，所有 Agent 缺省回退到这里。
- Agent 设置页编辑 Momo 的角色与规则即编辑全局共享规则，所见即所得；旧安装若在数据根有这些文件，需手动移入 `agents/default/`。

## 2026-10-11 — Agent 侧栏排序

- Agent 按最新对话时间排序，时间相同时按名称排序，修复编辑配置后列表顺序改变；默认 Agent（Momo）固定置顶，不参与时间排序。
- Agent 列表行不再显示「待命中」占位状态，仅保留工作中/已完成/失败/已停用等需要关注的状态。

## 2026-10-11 — 侧栏目录统一

- Agent、Agent Team、项目统一展开交互和滚动区域，一级标题支持吸顶，上方快捷入口保持固定。
- 吸顶标题不再绘制纯色底，改用背景模糊遮罩滚动内容，在半透明侧边栏材质的主题下不再出现突兀的底色卡片。

## 2026-10-11 — Agent 文件入口与右键菜单

- Agent 首页 header 新增文件入口，集中预览生成文件与上传附件，并返回来源对话。
- 左侧 Agent 右键菜单新增全部对话、文件与附件、设置。

## 2026-10-11 — Agent 对话列表

最近与全部对话移除独立来源列，渠道图标放在标题左侧，时间统一右对齐。

## 未发布 — MCP 底层改用 Pi 客户端（2026-10-11）

- MCP 连接与结果转换改用 Pi 的独立 MCP 实现，删除自维护的官方 SDK 接入与重复内容解析；MCP 设置、会话工具入口、权限审批、撤销、停止与恢复行为不变。
- MCP 服务器声明的注解进入权限分类，未声明注解不会被当作只读。

## 2026-10-11 — Agent 头像选择与角色配置

- 头像改为内置图案选择或本地上传，无需填写地址；图片保存在 workspace。
- 角色文件集中到“角色与规则”，说明身份、表达风格与协作规则的区别。

## 2026-10-11 — Agent 首页状态头像

- 圆形头像填满裁切；运行状态合并为头像角标，点击头像进入总览。

## 2026-10-11 — 隐藏空历史入口

未归属对话为空时，Desktop Agent 侧栏隐藏“未归属历史”；认领或删除后同步更新。

## 2026-10-11 — Desktop Agent 入口统一

Agent 与对话入口合并为一个分组，包含动画总览和各 Agent 首页。列表与首页显示共享运行状态，动画点击可直接开始对话，服务断连时清除过期状态。

## 未发布 — 房间设置（2026-10-11）

- 房间新增设置图标与独立设置页，可编辑名称、成员和协作方式。
- 修复侧栏“编辑成员”被房间导航覆盖而无法打开的问题。

## 未发布 — Agent 列表管理（2026-10-11）

- Agent 侧栏只显示身份入口；主区域的最近与全部列表支持右键删除，全部列表支持多选批量删除到回收站。
- 房间首页移除重复新对话按钮，会话顶栏使用图标；房间编辑与删除移至侧栏右键菜单。

## 未发布 — Agent 房间首页（2026-10-11）

- 房间与 Agent 复用首页、输入区和历史列表行；首页提供最近对话、新对话和全部历史入口，替代顶部会话下拉。

## 2026-10-11 — Agent 图标按钮主题适配

- Agent 设置与首页历史按钮随主题切换控件外观。

## 2026-10-11 — Agent settings

- 2026-10-11：Agent 设置改为主页主内容区内的二级页面，保留应用主侧栏；通用 Settings 入口保留通用导航。两个入口复用表单，窄容器分类横向排列，返回/保存回到入口。

- 2026-10-11：Agent“记忆与知识”接入现有记忆记录与独立归属检索，保留共享授权；移除 KNOWLEDGE.md 编辑与提示词注入。全局记忆后端、候选审核及维护保留在通用记忆中心。

- Added a dedicated six-section Agent settings page with a fixed save bar and an entry from the Agent homepage.
- Agents can independently select skills and direct tools, use shared personal memory, maintain knowledge, and bind existing bots or Web Profiles. Shared providers, connections and accounts remain in general settings.
- Agent settings survive restart; binding edits preserve credentials and channel policies.

## 未发布（2026-10-11）

- Agent 首页放大并上移头像，名称与简介居中排列；所有 Agent 未设置头像时统一使用 Molibot logo。

- 新对话页居中呈现头像、Agent 名称、提示与输入区，推荐紧接输入框下方，Agent 设置移至窗口 Header。

- 新对话页突出居中的输入框，推荐与最近对话缩为辅助内容，已有会话保持原聊天布局。

- Agent 首页最近对话与完整历史复用同一列表行组件，统一布局、来源信息和交互。

- Desktop 启动顶栏显示服务加载状态，等待初始页面恢复；失效恢复目标回到默认 Momo 首页。

- Agent 历史页先筛选和分页再生成预览，避免重复解析全部会话；统一顶部控件高度。

- Agent 历史来源列恢复使用 Session 侧栏的渠道 Logo。

- Agent 历史页采用标题、来源、更新时间三列布局与来源下拉筛选，窄窗口自动改为两行。

- Agent 的“查看全部”进入独立历史页面，搜索与分页限定当前 Agent，支持返回首页。

- Agent 首页增加集中身份介绍、快捷任务卡片和带预览的最近对话列表；顶部显示 Agent 名称，输入区保留在底部。

- 修复渠道会话切换时侧栏高亮停在旧会话的问题；已打开的历史即时展示缓存，连续切换不会被旧请求覆盖。

- 修复已完成迁移后，新建会话并重启又要求迁移的问题；搜索历史记录不再误拦迁移，旧目录可继续保留。

- 修复迁移后打开渠道会话时，文件列表重复解析迁移清单而阻塞服务、导致加载缓慢的问题。

- 迁移弹窗在服务重连后接续真实进度，禁止重复提交；批量保存迁移检查点，减少大量文件迁移时的重复清单写入。

- 修复大量历史文件迁移时，进度轮询反复全量扫描导致复制进度停滞。

- 修复旧 processing 媒体记录误拦会话迁移；引用冲突现在显示具体数据库、表名和状态。

## 未发布（2026-10-10）

- 修复同名 `default` 的旧历史记录误拦会话迁移；缺少归属的历史保留原值，可恢复任务仍需解决引用歧义。

- 修复迁移弹窗中 Agent 选择器与排除按钮错位，统一操作组对齐并适配窄窗口。

- 修复缺失 Bot 无法选择不迁移：其他格式数据库和历史执行日志不再被误判为未完成任务。

- Desktop 启动等待画面改为动态 Agent City 微缩城市，保留服务状态与故障恢复入口。

- 修复迁移弹窗关闭后误显示服务启动中，提供可见处理入口；服务就绪后才检查迁移，不可忽略的数据不显示忽略按钮。

- 缺失 Bot 的旧数据可选择不迁移，再迁移其余数据；无需修改文件，原文件保留，确认后记住选择。

- 迁移弹窗支持直接为缺失 Bot 的历史数据选择目标 Agent，解决归属后可确认迁移，无需手工编辑文件。
- 修复迁移弹窗长内容遮挡操作按钮，统一桌面主题与信息层级，操作底栏保持可见。
- 迁移弹窗明确说明旧 Bot 已不在当前配置中导致归属无法解析，并合并相关文件报错。
- 会话迁移自动跳过 scratch 中可重建的依赖与缓存，并支持忽略单项资源冲突后迁移其余数据；选择在确认时保存，原文件保留。

- 普通会话与资源统一按 Agent 存储，历史会话固定执行身份；Desktop 提供启动检测、确认迁移、冲突与重试。迁移保留原文件，完成前暂停运行与自动任务。

- 渠道与 Web Profile 的全局执行身份统一为 Momo（`default`），历史空绑定自动补齐，设置页默认选择明确的 Agent。
- 恢复 Agent 侧栏 Session 的右键菜单，保留复制路径、Finder 打开、重命名和删除确认。
- Desktop 普通对话改为 Agent 导航，提供首页、完整历史、独立草稿和页面恢复。
- 普通会话固定执行 Agent，统一模型优先级、私有记忆授权、启用与删除约束，外部历史保持只读。
- 历史普通会话在确认迁移时按原来源和已有归属关联，保留聊天记录。
- Agent 管理新增头像、可见性、默认 Agent 和 owner 记忆共享选项。

## v2.9.63（2026-10-08）

桌面端版本：0.9.63。

- 构建流程移除全项目 TypeScript 检查，避免桌面发布在该步骤耗尽 Node.js 堆内存；类型检查仍可通过 `check` 单独运行。
- 子代理支持结构化交接（目标、已知资料、缺失信息、约束、交付物、完成标准），减少重复探索；单任务委派同样生效。
- 共享运行时按“工具身份 + 参数 + 源版本”复用未变化的只读结果并跳过重复读取；写入/编辑自动失效，失败与读取期间版本变化不缓存，支持显式刷新。
- 对话运行时优先显示简短阶段说明、当前步骤与耗时，工具日志默认折叠；修复中断运行的进度报告，并用运行摘要校正历史回合错位。
- 模型输出上限可配置，截断的生成可恢复续写；明确多目标任务不再静默降级为普通单任务运行。
- Durable 恢复逐项验证工作项后再接受；运行异常结束时保留进度与已返回结果，说明停止位置。
- 桌面窗口合并为单一全局 Header 与三栏布局，内容浮层共享同一悬浮阴影；侧栏统一为图标网格并支持折叠。
- 子代理改用失败重试预算，正常轮次不再被轮数截断；MCP 单次工具请求两分钟超时，新增“停止当前任务”并保留排队消息。
- 修复桌面自动重连误停后台长任务、旧请求断连误停同会话后续运行；飞书与 Telegram 新建会话只展示常用菜单入口。
- Agent 与子代理增加资料复用及阶段说明指引；Agent 工具测试改用临时数据目录，不再与真实服务租约冲突。

验证边界：真实外部 Provider 与渠道验收仍待完成；桌面端检查本轮未执行。已通过的类型检查与 Agent 工具回归不代表这些项目已完成验证。

## 2026-10-08

- 修复只读缓存对外部文件修改及空白文件名的判断，支持显式刷新；单任务委派也能传递结构化交接。

- 修复原生委派测试与真实服务租约冲突：测试改用临时数据目录，不再读写真实数据目录。

- 子代理支持结构化交接（目标、已知资料、缺失信息、约束、交付物、完成标准），减少重复探索。
- 共享运行时按“工具身份 + 参数 + 源版本”复用未变化的只读结果并跳过重复读取；写入/编辑自动失效，失败不缓存。
- 对话运行时优先显示简短阶段说明、当前步骤与耗时，工具日志默认折叠；移除内部诊断进度，稳定更新子代理任务状态。
- Agent 与子代理增加资料复用及阶段说明指引，减少重复读取和抓取。

## 2026-10-07

- 修复桌面自动重连误停后台长任务，以及旧请求断连误停同会话后续运行；取消日志记录来源。

- 自动长任务判断改用所选决策模型，移除正文关键词误判；修复桌面长任务卡片单行溢出，保留换行并适配窄屏。

- 强化 Mini App 工具发现：应用检查返回可用工具及调用指引，精确工具搜索明确报告未匹配项，减少反复检查应用却未保存记录的情况。

- 桌面侧栏统一为一条图标网格：「对话 / 项目 / Agent Team」分区头带上与主导航同列的图标并与上方项左对齐（并移除主题对分区头的额外水平缩进）；分区头再次点击即折叠；Agent 房间更名为 Agent Team 并补上图标；项目改为 Filled `Package`、自动任务改为 Filled `SendClock`、计划改为 Filled `Bulb2`。

- 修复无最终答复的历史回合导致后续输入、回答和时间错位；保留纯工具过程，并用运行摘要校正异常状态和结果显示。

- Agent 监控或执行异常结束时保留进度和已返回结果，说明停止位置及待确认事项；长等待前先报告成果，避免把本地监控超时误报为远端任务失败。

- 桌面 Chat 顶部与侧栏共用窗口材质，统一主题配色与透明度；聊天、项目、房间和工作区使用内嵌内容容器，右侧面板与它拼接，容器圆角跟随主题。

- 桌面窗口改为单一全局 Header：原生红绿灯、侧栏切换、会话搜索／新对话与当前页面／会话标题及操作合并到同一顶部栏；聊天、项目、房间和全部工作区页面共用这条 Header，正文不再重复标题栏。

- 桌面窗口按三栏收紧：全局 Header 覆盖「侧栏 + 对话」两列，侧栏展开时标题左缘对齐对话内容左缘；打开的文件／小程序 Inspector 是独立全高第三列、其 header 与全局 Header 同处一条透明背景带；对话与 Inspector 内容通过一个等尺寸 frame overlay 共享同一悬浮阴影，读起来是一整块浮在「Header + 侧栏」之上的整体，只有面板自己的浅色左分割线。所有主题下 header 与侧栏统一材质：删除主题给窗口 header 区（27 个文件）和文件／小程序面板 header（26 个文件）的独立背景／边框／阴影。

- 子 Agent 改用模型失败重试预算，正常轮次不再在第 12 轮停止。子任务失败交回主 Agent 并显示真实失败状态；主模型无结论时输出进度、停止原因和未完成说明。

- 飞书与 Telegram 新建会话后只展示常用菜单入口，历史会话按需查看；运行中的菜单和状态卡直接提供“停止并继续队列”与“停止并清空”。

- MCP 单次工具请求两分钟超时；新增 `/stop current` 和“停止并继续队列”，取消当前任务后保留并继续排队消息。`/stop` 仍停止并清空队列。

- 修复 Agnes 视频已完成却因结果地址解析错误显示失败的问题。视频状态查询异常不再标记为生成失败，后续查询可以重试。

## v2.9.62（2026-10-05）

桌面端版本：0.9.62。

- Agent 房间支持新建和切换多次会话，聊天、成员上下文、草稿与模型选择按会话隔离；旧房间升级前备份，保留原聊天和上下文。会话事件只同步对应记录。
- 共享 Agent 执行接入 Pi 原生持久化任务和 Codemode；审批继续原任务，子任务共享取消与执行保护。修复父子工具争用执行锁的死锁，并加强停止、权限校验与 Durable 恢复保护。
- 主 Agent 失败重试与子任务模型轮次分别计数和持久化；正常模型轮次不消耗失败重试预算。原生工具在审批前校验参数。
- 桌面设置增加系统页，支持运行时区、Agent 预算、浏览器超时与跨渠道显示配置，保存仅更新修改字段。
- 增加可选 Pi 图片生成，复用 Provider 凭证，支持多图与伴随文本；Pi 图片用量纳入统一统计，删除历史仍保留计费事实。
- 桌面侧栏支持折叠图标栏与列表浮层，房间入口移入侧栏；欢迎页、项目运行状态、主题按钮及设置图标统一更新。

验证边界：真实外部 Provider 与渠道验收仍待完成；Web Svelte 检查仍存在页面与依赖声明错误。已通过的服务端构建与 Desktop 检查不代表这些项目已完成验证。

### Fixed: Validate native tool arguments before approval（2026-10-04）

- Agent 房间支持新建和切换多次会话，保留团队配置并隔离聊天、成员上下文和草稿；旧聊天先备份，再保留为第一条会话。

- 项目会话列表显示与对话列表一致的运行动画及状态标识。

原生工具准备恢复参数校验，避免无效输入先弹出审批、批准后才失败。权限限制保持不变。

### Fixed: Bash optional approval parameters（2026-10-04）

普通 Bash 可显式省略审批（null）；空审批理由在工具输入校验阶段拒绝，避免普通脚本因空审批对象而阻塞。

## 2026-10-04

- 模型失败重试与子任务模型轮次分别计数、持久化并报告耗尽原因；房间会话事件仅同步对应会话记录，恢复时保留全量同步。

- 修复 subagent 与子工具争用同一执行锁的死锁；等待锁的任务可及时取消，实际操作仍保留权限校验和串行保护。

- 桌面设置新增系统页，可调整运行时区、Agent 预算、浏览器超时和跨渠道显示；保存只更新修改字段。

- 修复主 Agent 将正常模型轮次计入失败重试预算的问题；默认允许失败后最多重试 6 次，正常多步任务不再在第 6 次请求后被截断。

- Agent 房间在成员停用或删除后仍可打开，文本提及只解析当前房间成员；只读讨论可正常使用 Codemode。
- 图片用量查询减少数据库读取；图片格式与扩展名保持一致，多图发送失败会报告已上传数量。Pi 图片配置明确复用 Provider 凭证。
- 录音结束时使用当前会话接收文件；房间导航统一处理浏览器与外部记录。Durable 恢复不再因同一操作的重复 intent 额外转人工核对。

- 修复共享 Button 的 variant 未映射到 `.primary-button`/`.secondary-button`，项目设置等对话框的按钮恢复应用主题；设置入口图标改为 Filled `Settings2`，小程序图标改为 `Widget2` duotone；设置导航按入口定制字形（审批管理/系统 Filled，服务日志/运行环境/Trace duotone）。
- Agent 房间列表移入左侧栏（折叠态为图标栏浮层），点击「对话 / 项目 / 房间」分区标题会把右侧内容切回上一次的对话、项目会话或房间。
- 本地 Chat 与项目新会话欢迎页统一为同一套快速开始卡片（拆解目标 / 分析问题 / 整理材料），卡片重设计为强调色图标卡片；侧栏自动任务图标更新。
- 折叠侧栏保留 48px 图标栏，对话/项目在图标栏旁按需展开列表浮层（复用展开态同一列表组件）；自动任务、技能、Agent、Agent 房间、计划、小程序点击后直接打开现有面板。
- 共享 Agent 执行接入 Pi 原生持久化任务，审批继续原任务，子任务共享预算与取消。异步模型响应重启后查询原请求，避免重复提交；未知提交、权限撤销和已停止任务拒绝自动恢复。真实外部 Provider 与渠道验收仍待验证。

### Fixed: Durable step budgets and usage receipts（2026-10-03）


Step tool and model-attempt budgets persist across retries and approval resume without changing their original limits. Usage records carrying a response identity are counted once across reopen and reject conflicting facts. Pi production kernel replacement remains in progress.

### Fixed: Stop while posting an approval（2026-10-03）

Stopping during approval notification or authorization consumption expires the unexecuted decision instead of leaving the task resumable.

### Fixed: Stop before approved process startup（2026-10-03）

Stopping an approved Host Bash operation during environment preparation prevents the process from starting.

### Fixed: Host Bash approval identity and cancellation（2026-10-03）

Approval by ID validates its scope and Session. Stable tool calls reuse their original approval; cancelled prepared operations expire without starting a process. Explicit approvals are prepared before execution and claimed only when execution begins.

### Fixed: Stop queued tool operations（2026-10-03）

Tools recheck cancellation and authority after acquiring their execution slot and before starting their handler. Stopping a queued write prevents it from running even when its handler ignores cancellation.

### Added: Pi Codemode（2026-10-03）

Agents can combine existing tools in isolated scripts and return selected results. Each nested operation retains permissions, approvals, budgets and audit receipts. Cancellation preserves partial output; approval continuation plans remaining operations without replaying completed writes.

### Added: Optional Pi image generation（2026-10-03）

Image settings use Pi image models and existing Provider credentials. Multiple outputs and companion text remain available for preview, download and channel delivery. Image estimates enter unified usage reporting; unknown prices stay explicit, and cancellation or history deletion preserves billing facts. Native Desktop cold startup and service recovery are verified; live Provider acceptance remains pending.

### Fixed: Multi-agent discussion execution（2026-10-03）

Mentioning multiple Room members now requests independent read-only answers instead of automatically proposing plans. Model previews follow backend routing, and persisted failed or interrupted replies display their actual execution state and useful error notices.


### Fixed: Room mention delivery and model context（2026-10-02）

Room requests carry the members selected by typed mentions. Each recipient receives its own author identity and the resolved recipient list as temporary runtime context, so mentions are understood as Room routing. Cold startup and reconnect preserve Room navigation.

### Fixed: Room mentions and shared Chat presentation（2026-10-02）

Agent Room messages now route `@name` and `@id` to the named members, including multi-member discussions. Rooms reuse Chat headers, transcript, live tool process, attachment rendering, composer and approval cards. Management actions use the shared overflow menu. Initial load failures and missed event heartbeats reconnect automatically.

### Fixed: Durable recovery checks every operation（2026-10-02）

An earlier non-idempotent operation now blocks automatic whole-step replay even when the last operation is safe. A single external-state probe cannot mark a multi-operation step completed; these cases require an explicit recovery review.

### Improved: Shared Agent Room composer（2026-10-02）

Agent Rooms now use the ordinary chat input component, including model/Thinking controls, attachment previews and recording controls. Member selection and reply context sit inside the composer. Explicit model and Thinking choices reach the execution request and persist for retries; the default keeps each member’s configured model.

### Improved: Agent Room setup（2026-10-02）

Room creation and member editing now group room details, an avatar-based team picker and collaboration settings. Selected members and save progress appear in a fixed footer; content scrolls inside the panel. Room headers support native window dragging, and the sidebar entry now follows Agent with a conversation icon. The layout supports Chinese/English, light/dark themes and a single-column picker at narrow widths.

### Fixed: Strict TypeScript checking（2026-10-02）

Root TypeScript checking passes after correcting SDK declarations, runtime dependencies, stale routes and test fixtures. Shared UI variants retain their existing styles and markup. Media test endpoints reject invalid engine/provider selections before generation. Run `corepack pnpm check` for the root check; production builds also run it before bundling.

Related regressions and production build pass. Web's full Svelte check still reports existing page and dependency declaration errors; Desktop's check has no errors and one existing warning.

### Fixed: Room quotes and recovery submissions（2026-10-02）

Room submissions reject explicit quotes that cannot fit the shared context budget instead of silently omitting them. Recovery and retry submission IDs persist across restarts; repeated requests return the original result, and conflicting requests are rejected.

### Added: Desktop Agent Rooms（2026-10-02）

Desktop can create regular or Project rooms with independent Agent identities and contexts, a shared attributed transcript, directed replies and restricted parallel discussion. Room-local write scheduling, approvals, cancellation and explicit restart recovery preserve execution evidence. See the [Room guide](docs/guides/agent-rooms.md); native Desktop acceptance remains pending.

### Changed: Pi runtime 1.0（2026-10-02）

Upgraded the three Pi runtime packages to 1.0.0. Requests retain system instructions and tool declarations under the new transcript API; approval suspension uses the new turn hook. ChatGPT OAuth receives a persistent installation identity, and Jev Auto decisions use Pi's classifier API. Existing model and OAuth catalogs pick up upstream additions.

Focused regressions, production build, Desktop typecheck and isolated runtime initialization pass. Live account authorization and paid model calls remain unverified; root TypeScript checking passes after the same-day follow-up fixes. See [integration assessment](docs/reviews/pi-1.0-upgrade-assessment.md) for feature coverage and exclusions.

### Fixed: Adaptive Thinking admission, cancellation and credential handling（2026-10-01）

Auto snapshots policy and decision destinations before queued execution. Stop and the decision deadline settle promptly even when a provider ignores cancellation; explicit retries receive a new decision while internal recovery reuses the existing one. Invalid confidence and missing follow-up context fall back safely. Jev errors no longer expose upstream payloads, and Web settings save credentials through the current per-connection API.

Decision records retain original rubric/context metadata and available usage/cost. A versioned paired outcome evaluator is available; live quality and savings remain unproven, so Auto stays opt-in. Related regressions, Desktop tests and server build pass. The full backend suite has six failures outside these regressions; existing global typecheck errors and one Desktop accessibility warning remain, detailed in `prd.md`.

## Archive Index / 归档索引
- [2026 Q2 Archive (Apr - Jun)](docs/archive/changelog-2026-Q2.md)
- [2026 Q1 Archive (Feb - Mar)](docs/archive/changelog-2026-Q1.md)
- [2026 Q3 Archive (Jul - Sep)](docs/archive/changelog-2026-Q3.md)

### Improved: 长命令实时进度（2026-10-07）

桌面聊天在命令执行期间显示最近输出和耗时，方便查看 GitHub Actions 等监控任务的当前步骤。长命令完成后保留独立条目，避免被普通命令摘要隐藏。
