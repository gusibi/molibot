# App 会话列表的轻量查询

日期：2026-09-19。状态：已实现（2026-09-19，见文末实施记录）。范围：App 中所有普通会话列表，包括 Web、外部渠道、Project、会话管理及其分页请求；复用这些共享查询的 Web 页面同样受益。

## Problem Statement

用户展开 Web 会话列表时，列表停留在加载状态，体感约一秒。侧栏只显示会话标题、时间和状态，不显示消息预览，却为全部 Web UI Session 加载聊天消息并计算预览，最后才过滤、排序和分页。

当前 `listAllWebConversations` 对每个会话调用 `listMessages`。运行时将后者接入聊天正文投影：读取 Agent Context 的消息记录、合并 UI 元数据，并补充记忆 trace、计划状态等展示信息。读取上限是每个会话 16 MB；大多数较小文件仍整体读取。这些工作只为取得最后一条可搜索的用户或助手消息的前 300 个字符。它是消息预览，不是模型生成的摘要。

2026-09-19 对运行中的本机列表接口直接计时，返回 1、10、100 条分别约为 405–446、370–380、362–386 ms。缩小分页没有明显降低耗时，与先处理全部会话再分页的实现一致。该计时仅覆盖 HTTP 请求，不代表已经测得点击到绘制的完整耗时，也未对投影内部各步骤单独计时。

## Solution

App 中普通会话列表及其后续页只读取 UI Session 元数据，不读取 Agent Context 消息、不执行聊天正文投影、不计算或返回消息预览。点击某个会话后，聊天视图继续按现有流程加载正文。

会话浏览／搜索弹窗仍显示并搜索消息预览。本次将它与普通列表的数据收集需求分开，不删除搜索能力，不引入摘要存储。实现者须盘点 App 的全部会话列表入口，逐项记录所用查询及验收结果，不能仅覆盖已实测的 Web 侧栏。搜索结果中明确展示预览的列表属于搜索流程，不要求删除其预览。

## User Stories

1. As a Molibot owner, I want every ordinary App conversation list to load only conversation metadata, so that opening the list does not wait for chat histories.
2. As a Molibot owner, I want long Agent Context histories to stay unread during listing, so that a long conversation does not slow down navigation.
3. As a Molibot owner, I want loading the next page to use the same lightweight query, so that pagination does not repeat transcript work.
4. As a Molibot owner, I want conversations from all my Web Bots to remain discoverable, so that the optimization does not hide existing conversations.
5. As a Molibot owner, I want stable newest-first ordering and cursor pagination, so that page boundaries do not duplicate or omit unchanged conversations.
6. As a Molibot owner, I want archived and trashed conversations excluded from the daily list, so that lifecycle rules remain effective.
7. As a Molibot owner, I want Project, automation and diagnostic Sessions excluded from the Web list, so that internal activity does not clutter navigation.
8. As a Molibot owner, I want titles, Bot identity, fork relationships and selection behavior preserved, so that existing navigation still works.
9. As a Molibot owner, I want opening a conversation to show its full supported transcript, so that a lightweight list does not reduce chat detail.
10. As a Molibot owner, I want the conversation search dialog to retain its message previews and matching behavior, so that finding conversations remains useful.
11. As a Molibot owner, I want restricted messages to remain excluded from searchable previews, so that performance changes preserve Turn Retention Policy.
12. As a Molibot owner, I want the improvement to work on the first open after restart, so that it does not depend on a warm transcript cache.
13. As a Molibot owner, I want external-channel lists to avoid parsing every Agent Context, so that switching channels stays responsive.
14. As a Molibot owner, I want Project conversation lists to use metadata, so that expanding a project does not load its histories.
15. As a Molibot owner, I want conversation management to retain its filters and counts without loading all transcripts, so that managing accumulated Sessions remains practical.

## Implementation Decisions

- 在共享 Desktop 会话查询层分离普通列表与搜索的数据收集需求。Channel 层仍只处理平台消息适配，不承接此次查询优化。
- Web 列表优先复用 SessionStore 已有的 `listAllWebConversationMeta` 能力。它仍可能枚举全部会话并读取 UI 元数据文件；本次不承诺只读取当前页文件；不得为 Web 列表额外引入数据库迁移或索引。
- 外部渠道当前也会从 Agent Context 消息生成列表信息，不能只去掉 preview 字段后仍保留正文解析。优先复用既有会话元数据；若标题、时间、是否为空、automation／历史事件分类等必要字段尚未独立存储，应在共享存储层随会话变化维护必要元数据，不新增消息摘要。已有会话的初始化须明确安排为列表请求之外的一次性派生索引构建，不能在每次列表读取时隐式回退到全文扫描；不建立旧格式兼容层。
- Project 和会话管理入口必须核对真实数据收集链路；已符合轻量读取要求的实现保持不变，仅补有意义的集成验证。
- 元数据查询不得间接调用 `listMessages`、聊天正文投影或 Agent Context 消息读取；不得为了生成不存在于侧栏的展示内容查询记忆 trace 或任务计划详情。
- 不展示预览的普通会话列表响应省略 `latestMessagePreview`，不返回空字符串占位，不增加前端清空摘要的补丁。搜索结果继续提供该字段；共享类型及调用者按真实使用范围调整。
- 实施前检查列表接口非空 `query` 的调用者。保留已支持的预览搜索语义：普通枚举走轻量路径，明确请求搜索的调用走搜索路径；不得静默将现有搜索缩减为仅标题匹配。
- 保留 Bot 过滤、生命周期过滤、purpose 分类、标题、时间、排序和 cursor 行为。过滤须在分页前完成，避免第一页被不应展示的会话占位。
- 聊天正文投影只在需要正文或既有搜索预览的流程使用。保持当前读取和保留策略，不改变 UI Session 与 Agent Context 的职责。
- 不新增摘要字段、后台摘要任务、持久化缓存、开关或兼容层。持久化预览是独立优化，需要另行覆盖消息编辑、删除及保留策略变化时的一致性。
- 本次不改变展开时的 loading 展示或刷新策略。先消除共享查询里的无用工作，避免把界面缓存当成解决后端开销的手段。

## Testing Decisions

以各 App 列表复用的共享会话查询入口为主要回归边界，使用真实 SessionStore 和临时数据目录／数据库。已有 `desktopConversations` 测试覆盖排序、游标、Bot 映射、purpose 分类和搜索；SessionStore 测试提供临时文件夹的先例。优先扩展这些测试，避免仅对纯映射函数做断言。用户已确认验收覆盖所有列表，以 App 为主。

- 建立会话元数据和非空 Agent Context 历史，调用实际普通列表查询。对消息投影／Agent Context 读取边界设置可观察计数或失败探针，证明列表返回正确且正文读取为零。探针只能替换底层读取边界，不能替换被测列表收集逻辑。
- 按入口覆盖 Web、外部渠道、Project、会话管理；不同入口若共享同一查询，复用用例，仅验证调用接线。不得以 Web 测试代替所有列表的证据。
- 同一测试覆盖首屏与下一页；增加历史正文体积而保持会话元数据不变时，正文读取仍为零。用确定性的读取约束防回归，避免将不稳定的毫秒阈值放进单元测试。
- 回归新旧更新时间相同的稳定排序、Bot 过滤、归档／回收站过滤、Project／automation／diagnostic 排除、空列表与分页结束，确认过滤先于分页。
- 回归搜索弹窗数据入口：预览仍存在，预览匹配仍有效；不可搜索的消息不进入预览。覆盖列表接口非空查询的现有语义，若调用者已收敛到独立搜索入口则核实该事实。
- 打开一个已列出的会话，确认消息正文及原有展示信息仍可加载，不能用删除消息投影能力来使列表测试通过。
- 使用同一运行模式和固定数据集记录优化前后首屏及分页请求耗时，至少各 10 次，报告中位数和范围；单独记录首次请求。再记录实际展开 Web 到列表显示的耗时，避免将 HTTP 耗时等同于用户等待。
- 必需验收：普通列表正文读取为零；数据语义回归通过；同条件下延迟确有下降。若总延迟仍接近基线，必须继续定位剩余耗时并报告，不宣称已解决用户等待；不预先承诺未经测量的延迟数值。
- 运行相关现有测试、适用的 svelte-check 和 build。对 Desktop 行为执行隔离冷启动冒烟：重启服务 → 首次打开各受影响列表 → 加载下一页／打开会话 → 切换 Session／页面 → 服务中断后恢复。不得启动使用真实 Bot 凭据的测试实例，也不得让测试读写用户数据。

## Out of Scope

- 优化搜索弹窗自身的全文／预览读取成本，或取消其消息预览。
- 持久化摘要、AI 总结、搜索索引重建、存储格式迁移。
- 与轻量查询无关的外部渠道或 Project 重构。
- 侧栏样式、loading 交互、前端缓存及后台刷新策略调整。
- 更改权限、Turn Retention Policy、会话归档／删除规则。

## Further Notes

- 术语遵循项目领域词汇：UI Session 表示界面会话及展示元数据，Agent Context 表示模型侧历史与继续执行状态。
- [会话管理规范](session-management-spec.md)已规定列表不得加载所有完整聊天记录。本规范将该原则统一落实到 App 会话列表查询，不替代会话管理的生命周期与批量操作要求；两份文档保留独立职责。
- 搜索与预览仍受[记忆命名空间和 Turn Retention Policy ADR](../adr/0001-memory-namespace-and-turn-retention.md)约束。
- 现有读取字节上限约束单个聊天，无法阻止列表对全部会话重复投影；已有纯排序／分页测试也不覆盖数据收集的 I/O 成本。新增回归应拦住这类“列表误用详情读取”的问题。
- 实现完成后记录实测结果、未完成检查及文档影响；按项目规则更新交付记录。上述性能基线只对 Web 实测，其他入口须在实施时补测。当前文档仅定义待实现要求，不表示性能优化已经交付。

## 实施记录（2026-09-19）

- **Web 普通列表**：`listDesktopConversations` 在无 `query` 时改走 `SessionStore.listAllWebConversationMeta`，不再调用 `listMessages`；带 `query` 的列表请求仍走预览路径，搜索弹窗（`/api/desktop/conversations/search`）保持原有预览匹配。
- **外部渠道**：Agent 存储在 `<sessionId>.meta.json` 的 `display` 字段维护 `{title, createdAt, updatedAt, hasMessages, eventPrompt}`，由 `MomRuntimeStore` 的两条写入口（追加、全量重写）随会话变化刷新；普通列表 `listExternalSessionMetaFromContexts` 只读该 sidecar，不再解析 Agent Context。`listExternalSessionsFromContexts` 保留给搜索、反思、会话检索工具等需要正文的流程。
- **已有会话初始化**：新增 `rebuildExternalSessionMetadata`，在服务启动时（`runtime.ts`，`setTimeout(0)` 移出请求路径）一次性为缺 metadata 的历史会话派生索引；列表读取不会隐式回退全文扫描。
- **Project 列表**：`listProjectConversations` 本就只读 UI Session 元数据，未改动；新增集成回归锁死“project 列表不得调用消息投影”。
- **会话管理**：`listManagedExternalCandidates` 改用 metadata 投影；本地/Project 候选继续使用 UI 元数据与 `listMessageMetadata`，不触发聊天正文投影。
- **响应形状**：普通列表省略 `latestMessagePreview`（不是空字符串占位）；搜索路径继续提供。
- **机器守卫**：`desktopConversations.test.ts` 用可注入 query context 与抛错/计数投影器证明普通列表零正文读取、省略 preview、page 2 cursor；`externalSessionMetadata.test.ts` 用损坏的 `.jsonl` 作为失败探针证明 metadata 列表不解析正文，并覆盖 backfill 幂等、origin 保留、automation/Event/空会话排除；`externalSessionMetadata.test.ts` 覆盖会话管理候选复用 metadata 投影。
- **实测（隔离临时数据 + 合成大正文，脚本 `scripts/bench-session-list-latency.ts`，12 次取中位数与范围）**：
  - Web 60 会话 ×120 消息：重路径（`listAllWebConversations` + 投影）中位 23.7 ms（23.0–26.7）；轻路径普通列表中位 4.5 ms（4.0–5.2）；带 `query` 搜索路径中位 23.4 ms。
  - 外部 40 会话 ×120 消息：重路径中位 14.7 ms（14.0–15.6）；metadata 普通列表中位 0.8 ms（0.7–1.1）。
  - 首次请求与后续中位数差距在噪声范围内（Web 轻路径首 4.9 ms / 中位 4.5 ms）。合成投影不含真实运行时的 memory trace、durable execution plan 读取，真实环境下降幅度只会更大；脚本不承诺具体数值，用于回归对比。
- **冷启动冒烟（隔离 DATA_DIR，HTTP 层）**：重启服务 → 首次打开外部列表触发 `session_metadata_backfill scanned=13 rebuilt=13` → 普通列表 10 条/hasMore/最新在前且无 preview 字段 → 下一页 3 条/hasMore=false → 搜索端点仍返回 preview。打开会话正文的链路（`readExternalTranscriptFromContexts`）未改动，未在本环境执行 UI 点击到绘制的完整走查。
- **未完成检查**：未在真实浏览器/桌面 UI 上测“展开 Web 到列表显示”的端到端耗时；未执行服务中断后恢复的 UI 走查；`desktopApprovals.test.ts` 有 1 条与本改动无关的既有失败，已在 master 基线复现。
- **验证**：全量 server 测试 2185 项中 2183 通过（1 项既有失败、1 项 skip）；`test:desktop-chat` / `test:projects` / `test:service-bootstrap` / `test:evals` 全通过；`svelte-check`（desktop）0 error；`pnpm run build` 通过；`tsc --noEmit` 无新增错误。
