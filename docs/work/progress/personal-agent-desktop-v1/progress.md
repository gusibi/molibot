# Personal Agent Desktop V1 实施与验证

完成日期：2026-10-10。当前能力状态以 [能力矩阵](../../../requirements/personal-assistant-capability-matrix.md) 为准，持续验收依据为 [实施规格](../../../requirements/personal-agent-desktop-v1-spec.md)。

## 交付范围

- 普通 Session 在共享存储与 Runner 中固定 Agent ID；新建、继续、认领、控制和文件读取使用同一执行上下文。Project 保持原边界。
- 默认 Agent 始终显示、置顶并标记；全局新对话进入默认 Agent，每个启用 Agent 的“＋”进入指定草稿。内置默认身份仍在使用且未删除时，配置补齐缺少的真实默认条目。
- Desktop Agent 首页、头像和简介、多组历史展开、完整历史与跨 Agent 搜索、每 Agent 草稿、上次页面恢复。超过最近列表容量的会话按 ID 恢复。
- Session 模型覆盖优先于当前 Agent 默认及全局默认；首次发送的草稿设置在发起时固定。切换页面后，后台创建、回答和文件请求不覆盖当前页面。
- Agent 默认选择、可见性、启用、owner 共享、稳定 ID 和删除 tombstone。删除前检查渠道/任务引用、审批和非终态运行，普通历史幂等归档，Project 不参与。
- 外部 Session 的持久身份、改绑后新会话、只读认领分类；定时事件按固定执行身份记录禁用跳过，周期事件不补跑错过的 slot。
- 记忆 Gateway 统一授权读取、修改和维护；反思候选遵循 Agent namespace，关闭 owner 共享仍保留本 Agent 私有 profile 注入。删除 Agent 的私有记忆留存但不进入新身份。
- 导航只写独立 SQLite dynamic key，不重写 provider/channel/Agent 配置，也不重启渠道服务；新增设置字段完整 round-trip。

## 自动检查

- 服务端全量：2525 项，2519 通过、5 失败、1 跳过。5 项失败已在实施前独立 HEAD 基线复现：Python tooling 路径假设、Mini App 子进程继承 DB_DIR、Desktop Broker 审批列表、两项 Session fork 用例。本次未修无关问题，不能宣称全量全绿。
- 全量之后的默认 Agent/配置改动：26 项相关回归通过，覆盖已有自建列表的默认条目、删除约束及设置 round-trip。
- 全量之后的私有 profile/授权改动：29 项针对性回归通过，包含真实 Provider 请求中的身份、私有知识、模型覆盖和进程重启；Gateway 旧 scope 权限变化及删除回归通过。
- Desktop：334 项行为测试、298 项源码守卫、70 项 Rust 测试通过。新增首次创建等待期间切换 Agent、返回原 Agent 输入新草稿的行为回归。
- `check`、`desktop:check`、服务端与 Desktop build 通过。Desktop 保留原有 AgentCityInspector 的一项无障碍 warning；打包保留既有大 chunk warning。
- 全部持久化测试使用临时数据库或隔离 DATA_DIR，没有读写用户运行数据库。

## 冷路径走查

隔离服务、临时配置及本地 SSE Provider 连接 Desktop 官方预览入口，使用真实页面操作：

1. 首次打开默认 Agent 首页，初始历史折叠，内部 Agent 隐藏但设置页可管理。
2. 分别输入两份 Agent 草稿并切换，原草稿恢复；独立展开多个历史组。
3. 首次发送产生固定 Researcher Session 并收到真实 Runner 回复；刷新恢复原会话和展开状态。
4. 停止隔离服务，再以同一 DATA_DIR 重启；页面恢复后在原 Session 继续发送并收到回复。
5. 默认标记与列表置顶、Writer 的“＋”进入 Writer、全局新对话进入默认 Researcher，首次发送得到回复。
6. 中英文即时切换、明暗模式、520px 窗口的 Agent 编辑表单及固定保存栏；禁用 Agent 首页无发送入口。

未中断用户服务。人工 UI 验证使用 Desktop 官方浏览器预览，未启动原生 macOS 窗口做完整人工走查；原生部分由 Rust 测试覆盖。外部真实渠道和付费 Provider 未做在线验收。

## 审查与边界

标准与规格双轴审查完成。发现的身份缓存、审批恢复、反思写入、删除引用、导航响应式和存储粒度、首次发送/文件异步串页问题已修正，并按风险补回归。

这些修复的根因分别属于上下文身份、授权层级与异步竞态；共享 admission/Gateway、完整 round-trip、状态守卫和行为测试负责拦截同类问题。默认 Agent 缺失属于默认值补全遗漏；旧守卫只覆盖空列表，没有覆盖“仅自建条目”的配置，本次补了该配置回归。没有引入临时补丁，无需新增重复的长期协作规则。

独立 Web 页面保持原结构。历史 Session 在共享层按 Bot 目录和有效 Agent 绑定自动关联；仍缺失有效绑定的未归属历史只读，可在 Desktop 显式认领。独立 Web 没有新增认领控件。

PRD 与规格保留在 requirements：稳定身份、权限、删除与 Project 边界仍能指导后续改动。未新增并行计划或发布任务；本次不包含部署或 issue tracker 发布。


## 2026-10-10 — 按 Bot 目录自动关联历史

用户明确要求利用已有 Bot 目录和 Agent 绑定自动关联，替代此前对所有未知归属历史要求手动认领的约定。共享层在启动时补齐，并在 Bot/Agent 配置更新前固定旧绑定、更新后关联新有效绑定。已有归属优先；Project、自动任务和缺失有效绑定的历史不参与，不改聊天正文或活动时间。

根因属于身份元数据未补齐：原守卫只验证“显式认领”和执行拒绝，没有覆盖目录已提供可靠 Bot 身份的历史。新增回归覆盖自动关联、重启、重复执行、Bot 改绑、禁用 Agent 的历史展示、删除/缺失绑定、Web 与 Context 身份优先级、自动任务排除和冲突报告；不需要新增长期规则。

针对性测试 17 项通过，类型检查和服务端构建通过。完整后端测试 2530 项，2524 通过、5 失败、1 跳过；失败仍是前文已复现的 Python tooling、Mini App 验证子进程、Broker 审批列表与两项 Session fork 基线问题。隔离子进程验证历史文件在首次初始化后立即出现在默认 Agent 列表，进程重启后首次列表仍可读。没有中断用户服务；本次未改 UI。

按用户授权处理实际历史：补齐 69 条 Web 会话和 94 条 Context 元数据，无身份冲突；第二次执行零修改。已有展示索引扫描 380 条，均无需重建。还有 121 条可见历史没有有效绑定，保持未归属。Bot 改绑前没有持久身份的旧记录按当前有效绑定首次固定，无法恢复未记录的历史配置版本。


## 2026-10-10 — Session 右键菜单保留

AgentNavigation 遗漏 ConversationRow 的路径操作回调，外部只读会话因此没有任何可用菜单项。恢复复制路径、Finder 打开及完整翻译标签，继续复用共享组件的重命名、删除确认和 Portal 浮层。新增源码守卫覆盖 ChatView → AgentNavigation → ConversationRow 的接线，避免只测底层组件而漏掉新入口。

Desktop 9 项预检查、334 项行为测试、299 项源码守卫和 70 项 Rust 测试通过；Desktop 类型检查与构建通过，保留既有 Agent City 可访问性警告。隔离服务冷启动后首次右键显示完整菜单，复制路径有成功提示，删除确认可取消，切换 Session 后仍可用；隔离服务中断、重启及重新加载后菜单恢复。没有中断用户服务，原生 Finder 窗口未人工验证。


## 2026-10-10 — Momo/global 语义与空绑定

实际设置中 `defaultAgentId` 为 `default`，Agent 名称为 Momo，但 15 个渠道 Bot 仍保存空 Agent ID。原提示词的 global 规则会生效，旧 UI 将该状态叫“无 Agent／全局兜底”，新的稳定身份执行与历史关联却把它当作未分配。根因是默认配置语义与执行身份没有统一；上一轮守卫漏测了“Bot 存在但绑定为空”，本次该回归先失败再通过。

共享 `normalizeChannelAgentId` 将已配置 Bot 的空值规范化为固定 `default`，设置读写、渠道初始化和历史关联采用同一语义。Momo 的存在不依赖新对话默认偏好，但删除记录仍有效；未知 Bot、显式失效 Agent 和已经固定的 Session 不重新分配。Desktop 与独立 Web 的渠道/Profile 选择都不再提供空 Agent 选项。只用 channels 动态 key 保存实际配置，不移动或覆盖根目录及 Agent 人设文件。

实际数据补齐 15 个 Bot、161 条 Context，用户示例 Agent ID 为 `default`，重复执行零修改、零冲突；可见 Momo Context 历史为 198 条。仅剩 1 条未归属历史，来源 Web Bot `personal` 已不存在于配置。直接渲染示例 Bot 的真实系统提示词，原全局 SOUL 标题仅出现一次，Agent 专属人设文件为空，现有全局人设仍生效；未调用付费模型。

临时数据库的 saveChannels → 新 Store → load 覆盖完整设置对象及渠道所有支持字段，验证物理 agent_id 为 `default` 且不覆盖其他设置。46 项设置/历史与 52 项提示词/执行回归通过。完整后端 2533 项，2527 通过、5 项前文已复现的基线失败、1 跳过。Desktop 9 项预检查、334 项行为、300 项源码守卫、70 项 Rust 测试通过；两端类型检查与构建通过，Desktop 保留既有 Agent City 可访问性警告。

隔离 Desktop 构建预览与独立 Web 飞书设置核对初始 Momo 选择；即使新对话默认是 Researcher，新建 Bot/Profile 仍选 Momo。中英文即时切换、明暗主题与 520px 表单检查通过，保存按钮位于窗口内；Profile 保存后显示 Momo，隔离服务重启后读取同一绑定。用户服务未中断。未在原生 macOS 窗口做本轮完整人工验证。
