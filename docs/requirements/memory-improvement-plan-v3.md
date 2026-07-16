# 记忆系统改进任务清单 v3（Memory Improvement Plan v3 — 回路闭合与画像真实化）

> 日期：2026-07-16（v3.2，已纳入第二轮技术审查修正）
> 背景：v2.2 清单（`memory-improvement-plan.md`）的 T1–T7 已全部交付：mory 唯一后端、namespace/domain、稳定路径与版本链、每日反思 + Candidate Inbox、语义检索、审计与遗忘机制、记忆 trace 与记忆中心。对照 OpenClaw / Hermes Agent 的记忆架构复盘后结论是：**架构已是目标形态（候选层 + 置信度 + 溯源 + 用户审核，两家都没有），缺的是几个没有闭合的回路**——反馈不回流、反思只抽取不演变、画像是 recency 切片、巩固遗忘无排程。"越用越好"由回路决定，不由存储决定。
> 直接诱因（owner 反馈 2026-07-16）：记忆中心"综合画像 / 稳定偏好"实际展示的是最近记忆切片，与产品文案语义不符——**给出的是错误数据**。此为本清单第一优先级。
> 约束：本文档只做规划，不包含实现。实现时每个任务按 AGENTS.md 规则同步更新 `features.md` / `CHANGELOG.md`。

## 现状链路速览（实现前必读，均已按代码核实）

- **画像数据窗口**：Desktop 记忆中心加载 `list` + `allScopes` + `limit 200`（`apps/desktop/src/lib/stores/memory.svelte.ts:33`）→ 服务端映射为 `searchAll({ mode: "recent", limit: 200 })`（`src/routes/api/desktop/memory/+server.ts:69`）→ mory recent 模式纯按 `updatedAt` 打分（`moryCore.ts:346`）。**画像原料 = 最近更新的 200 条**，总量超 200 后旧的 pinned 稳定偏好整体掉出输入。
- **画像投影**：`apps/desktop/src/lib/settings/memoryCenter.ts` 的 `projectMemoryCenter` 在客户端做确定性投影。"稳定偏好" = recency 排序 → 正则过滤 → 取前 6（`memoryCenter.ts:145`），未使用 pin/confidence/版本存活/accessCount 任何稳定性信号；"当前主线"同为 recency 优先；唯一使用 `retentionScore`（`memoryCenter.ts:75`）的是三句摘录拼接的 summary，且"基于 N 条长期记忆"的 N 是窗口内 long_term 总数，实际参与 3 条。
- **反馈**：`traceStore.ts:75` 的 `memory_trace_feedback` 表记录有帮助/无关/错误/过时/过于私人，**全库无消费者**，不回流 confidence/utility/expiry/suppression。
- **使用信号**：底层 mory 节点已有 `utility` / `accessCount` / `lastAccessedAt`，`moryForgetting` 也已有频率权重；但常规 `retrieve/search` 当前**不写回** `accessCount`，只有 `readByPath` 会递增。因此“被检索”“被实际注入”“被用户认为有帮助”三种信号尚未区分，不能直接作为稳定性或遗忘依据。
- **数据投影与状态**：底层节点已有 version / supersedes / archivedAt / utility / accessCount 等字段，但 `MemoryRecord` 与 trace 注入项没有完整投影 namespace、版本/使用状态；`compact` 重建重复记录 metadata 时也未保留 `allowInjection`。这会使隐私禁注入状态在维护后意外恢复，必须先修复。
- **反思**：`ReflectionExtractor` 输入只有 `target + projection`（`reflection.ts:40`），**不含既有相关记忆**——v2.2 T3 写明的"既有相关记忆（供判断新旧与演变）"未落地；抽取器无法判断修正/演变，只能产出新候选。
- **巩固/遗忘**：`gateway.compact()`（`gateway.ts:368`）调用方只有 Agent 工具与 UI，无任何定时器；`moryConsolidation` / `moryForgetting` 大部分时间闲置。
- **候选去重**：fingerprint 只在同一 ReflectionRunKey 内去重；跨天重复的同类候选各自新建，无证据累积。
- **会话找回**：Agent 工具只有记忆 search，无跨会话 transcript 全文检索。

---

## C0 [P0] 数据定位、状态语义与安全不变量（全批次共同前置）

**为什么必须先做**：现有 `MemoryRecord`、trace 与维护路径没有完整携带“记录属于谁、来自哪个 namespace、为什么不能注入”的信息。直接实施画像、反馈或排程会造成跨 Bot 画像混入、反馈无法安全定位，以及私密记忆经 compact 后重新注入。

**契约要点**：

1. **授权范围与来源信息分离**：不得把“由哪个 Bot/渠道创建”直接当成“谁可以读取”。
   - 请求侧使用不可由客户端自由拼装的 `MemoryAccessScope`：`ownerId`、`botId`、`channel`、`externalUserId/chatId`、可选 `conversationId/projectId`，以及服务端从当前身份、Bot 配置和项目成员关系推导出的 `authorizedNamespaces`；所有读取、按 id 回写、画像构建、会话检索和维护操作都必须在 SQL/storage 层先与该 allowlist 求交集。
   - 记录侧保留 `namespace/domain` 作为归属与共享边界，另以可选 `originBotId/originChannel/originExternalUserId/originProjectId` 表示 provenance。owner namespace 是否跨 Bot 共享只由授权策略决定，不能因 `originBotId` 不同而误拒绝，也不能因 owner 相同而默认跨 Bot 放行。
   - `MemoryRecord`、`MemoryInjectionItem`、`MemoryTurnTrace` 必须携带足以复核授权的 namespace、scope snapshot 与注入来源 `profile | retrieved`。不得用 `searchAll()` 作为当前会话或当前 Bot 的画像原料。
2. **统一状态语义**：明确并在所有读取路径一致执行 `active | disputed | dormant | archived` 与 privacy suppression 的语义：
   - `privacy` suppression 是不可被普通编辑、去重或 compact 覆盖的注入阻断；
   - `disputed` 立即停止注入，保留待裁决；
   - `dormant` 默认不注入，可仅在显式历史/审计查询中出现；
   - `archived` 不参与普通 search 或 prompt，只能从历史/版本链恢复。
   `allowInjection`、privacy suppression、pin、expiresAt、sources、reason 等 metadata 在 add/update/去重/compact 后必须完整 round-trip。
3. **真实使用信号**：区分 retrieved、selected、injected、feedback 四类事件。仅在记忆实际进入成功模型回合的 prompt 后，以幂等 key 记录一次 `injectionCount` / `lastInjectedAt`；普通检索不能虚增使用频率。`utility` 与该使用信号必须纳入后续 retention 计算。
4. **审计与原子性**：反馈、状态变更、候选确认/聚合与维护动作均经 gateway 单一入口写入治理/审计；每项动作有可重放的 idempotency key。影响数据与审计记录必须同一事务完成，或采用可恢复 outbox。
5. **读取与恢复边界**：明确“归档后仍可搜索”的产品语义为“历史/版本/审计界面可查”，不是普通 Agent memory search；若将来需要低权重召回，使用 `dormant`，不复用 archive。
6. **存量迁移与兼容**：为现有节点定义确定性映射：未归档且无冲突 → `active`，冲突 → `disputed`，已归档 → `archived`；缺失的 provenance 字段保持 `unknown`，不得猜测并扩大授权。迁移需可重复执行、可 dry-run，并在临时数据库上验证旧版数据、未知 metadata、`allowInjection === false` 和版本链全部保留。

**验收标准**：不同 Bot、owner、chat/project 的画像和 prompt 按显式授权严格隔离；owner 记忆仅在授权策略明确允许时跨 Bot 共享；无法对不属于 trace effective injectedItems 的 memoryId 提交反馈；`too_private → compact → restart` 后记录不出现在 profile、检索注入或候选中；检索未注入的记录不增加使用计数，实际注入重试不重复计数；所有 metadata 经 compact 后保持不变；旧数据库迁移可重复且不扩大授权；状态变更与审计可一起重放恢复。

**依赖**：无。C1、T10–T18 均依赖 C0。

---

## C1 [P0] 画像构建器契约（T10 / T13 的共同前置）

**一个构建器，两个消费方**：记忆中心 UI 的画像板块与每轮 prompt 的常驻画像注入，必须使用同一个服务端 `MemoryProfileBuilder`，避免“UI 显示的画像”和“模型看到的画像”分叉。

**契约要点**：

1. **位置与显式 scope**：构建器位于服务端共享层（`src/lib/server/memory/` 下新模块），不在 WebView / Desktop 客户端投影。输入必须是服务端构造的 `MemoryProfileScope`：`ownerId`、`botId`、`channel`、`externalUserId/chatId`、可选 `conversationId/projectId`、`includeOwner`、`includeAgentSelf` 与 `authorizedNamespaces`。`currentFocus` 只能读取当前 chat/project namespace；owner/agent 层是否合并由显式开关和授权策略决定。Desktop API 只返回投影结果；跨 Bot 总览必须使用单独权限并在 UI 标识范围。
2. **输入取数按画像语义，不设 updatedAt 窗口**：
   - 稳定偏好层：当前 scope 中的 `user_preference`；`user_fact` 单列为谨慎展示的 profile facts，默认不把敏感或无关身份事实拼进“综合画像”；
   - 当前主线层：当前 project/chat 范围的 active `task` / `event`；
   - 稳定排序采用确定性词典序：`pinned desc → activeVersionAgeBucket desc → confidence desc → utility desc → log1p(injectionCount) desc → updatedAt desc → id asc`。`activeVersionAgeBucket` 固定映射为 `<7d=0 / 7–30d=1 / 30–180d=2 / ≥180d=3`，缺失 confidence/utility/count 按 0；recency 只作平手项。版本链总长度不是稳定性信号——频繁被修正不应加分；
   - 排除：privacy-suppressed、`allowInjection === false`、`disputed`、`hasConflict`、已过期、dormant/archived 不进入画像正文；它们只进入“需要注意/历史”且按权限显示；
   - 近期层：独立 recent 查询，仅服务“近期新增”板块。
   - “不设 updatedAt 窗口”不等于全库加载：后端必须按 namespace + type + state 建索引，每个板块在存储层按上述顺序分页取有界 top-K；超出预算时返回 `meta.truncated=true` 和扫描/排除数，不得静默退化为 `searchAll()` 或内存全表排序。
3. **输出结构**（供两个消费方裁剪）：`{ summary, stablePreferences[], profileFacts[], currentFocus[], recentItems[], attentionItems[], meta }`。`meta` 必须给每个板块标注实际参与条数、scope、选取规则与排除数；UI 文案据此渲染，禁止“基于 N 条”而实际只展示 3 条的泛化表述。
4. **summary 保持确定性投影**：按 topic 各选稳定性分最高的代表条目，以结构化模板拼接。v3 不引入 LLM 综合画像；LLM 维护画像综述记忆仅可作为 T18 之后、经候选确认的可选演进。
5. **注入形态与安全撤销（T13 消费）**：从稳定层构建有界画像块（默认约 500 token，CJK-aware 估算复用 `moryTokenize`）。首轮把 item IDs、渲染文本、base fingerprint 作为版本化 session snapshot 持久化；无治理状态变化时，会话内与重启恢复后 base snapshot 字节不变。每轮真正注入前必须按当前状态应用 `governance revocation overlay`：privacy suppression、`allowInjection === false`、disputed/dormant/archived/过期可从旧 snapshot 中删除条目，但不得在旧会话自动补入新条目。最终 trace 同时记录 base fingerprint、撤销项及 effective injected items。画像继续置于 user envelope，system prompt 保持字节一致；检索通道继续负责长尾，画像有效条目从检索注入中去重。

---

## T10 [P0] 记忆中心画像真实化（直接诱因，最高优先级）

**现状问题**：见速览前两条。"综合画像 / 稳定偏好 / 当前主线"名不副实——是最近 200 条的 recency 切片，记忆越多画像越"近视"；"稳定"没有任何稳定性信号参与；"基于 N 条长期记忆"高估综合程度。

**改进目标**：

1. 接入 C1 `MemoryProfileBuilder`，Desktop 记忆中心"概览"Tab 全部板块改为消费其输出；删除客户端 `projectMemoryCenter` 中与之重复的选取逻辑（topic 归类等纯展示逻辑可保留在客户端）。
2. "稳定偏好"按 C1 稳定性分排序；pinned 且长期存活的偏好必须稳定出现，不被昨天随手记的一条偏好顶掉。
3. "近期新增"保持 recency 语义（名副其实，不改）；"需要注意"继续承载 conflict / 禁注入 / 已过期。
4. **UI 文案诚实化**：所有板块的来源说明与实际选取规则一致；`memoryUnderstandingMeta` 等 i18n 文案按 meta 重写（中英同步）。
5. "全部记忆 / 主题"Tab 维持现状（列表页按 recency 合理）。

**验收标准**：构造 >200 条**当前 profile scope 内**的 fixture，其中一条 6 个月前确认、pinned、confidence 0.95 的 owner 偏好——它必须出现在“稳定偏好”首位，且不出现在“近期新增”；一条昨天新增的低 confidence 偏好不得排在其前；conflict / 禁注入 / privacy-suppressed / disputed / 过期条目不出现在画像正文；另一 Bot、chat 或 project 的记忆不混入当前画像，owner 记忆只按显式授权共享；每个板块的 UI 说明文字与实际参与条数、scope、截断状态和排除数一致；投影单测覆盖稳定性排序、窗口无关性、分页稳定性和跨 Bot/chat 隔离；`svelte-check` 0/0 + Desktop UI 测试 + production build。

**依赖**：C0、C1。

## T11 [P0] 反馈回流记分（“越用越好”的字面实现）

**现状问题**：trace 反馈落库即死（速览第 3 条）；底层存在 utility/频率能力，但现有 trace 未保存完整 namespace/scope，且常规检索并不递增 `accessCount`，不能安全或准确地回流。

**改进目标**：纯确定性规则，零 LLM 成本。`gateway` 提供唯一入口 `applyTraceFeedback`；它先从 trace 的持久化定位信息恢复原 namespace/scope，验证 `memoryId` 的确属于该 trace 的 effective injectedItems，再通过 append-only feedback event + 当前状态投影，在同一事务（或可恢复 outbox）中更新副作用与审计：

| 反馈 | 动作 |
|------|------|
| 有帮助 | utility 上调（有界，如 +0.1 clamp 0–1） |
| 无关 | utility 下调 |
| 错误 | 置 disputed/conflict + confidence 下调；立即停止注入，进入“需要注意”供复核 |
| 过时 | 设 `expiresAt`（立即或配置宽限期）；pin 豁免保持不变 |
| 过于私人 | 写入不可被 compact/去重覆盖的 `privacy` suppression，立即停止 prompt/profile 注入，并以确定性 suppression key 阻止同类候选再次进入 Inbox |

- 每次提交携带独立 `idempotencyKey`；事件表 append-only，另维护 `(traceId, memoryId)` 的 current feedback 投影和该反馈拥有的 effect ledger。重复同一 key 不执行；改变 value 时替换该反馈的 active contribution，`utility = clamp(baseUtility + Σ activeFeedbackContributions, 0, 1)`，避免 clamp 后再做反向加减造成数值漂移；不能仅覆盖反馈行，也不能重复累计 utility/confidence。
- `helpful/irrelevant` 的 utility 贡献可逆；`incorrect` 引起的 disputed/confidence 变化只有在该状态完全由此反馈创建、且不存在其他 dispute/source 时才可由改值撤销；`expired` 同理只能撤销自身拥有的 expiresAt 变更。
- `too_private` 是高优先级安全动作：改变反馈 value 不自动解除 privacy suppression。只能由用户在记忆中心执行独立的“恢复注入”治理动作，并再次确认范围；该动作保留完整审计，普通编辑、反馈覆盖、compact 和候选确认均不能解除。
- 注入使用信号仅在成功回合实际进入 prompt 后写入；检索但未注入不得影响 utility/频率。
- 历史存量反馈提供显式的一次性回放命令；回放保持同一幂等规则并可 dry-run。

**验收标准**：不能对不在 trace effective injectedItems 中的 memoryId 提交反馈；对同一 idempotency key 重试“有帮助”，utility 只变化一次；`helpful → irrelevant → helpful` 的最终贡献等于只提交一次 helpful；`incorrect → helpful` 仅撤销由该反馈独占创建的 dispute，不覆盖其他冲突来源；“过于私人”后即使改变 feedback value、compact 与重启，该条仍不出现在任何 prompt/profile 注入且同类候选被抑制，只有显式治理恢复动作可以解除；“过时”后生效并由维护归档（pin 豁免不变）；检索未注入不增加使用计数、实际注入重试不重复计数；每次回流动作在审计日志可查且可回放；memory 全套测试 + 新增回流单测通过。

**依赖**：C0；可与 T10 并行。

## T12 [P0] 反思携带既有记忆（从"堆积"到"演变"）

**现状问题**：`ReflectionExtractor` 输入不含既有记忆（速览第 5 条），无法识别修正与演变，跨天重复产出相似候选，Inbox 疲劳，端到端场景 2（偏好演变可追溯）只在用户手动改时成立。

**改进目标**：

1. `ReflectionExtractor.extract` 输入增加有界的 `relatedMemories`：反思服务依据 projection 内容，仅在当前 target 的 authorized namespaces 内先行检索（如 topK 12）。传给 LLM 的记录使用短引用 token（`R1`、`R2`），并附 namespace/type/subject/path 与内容摘要，不暴露可伪造的内部 memoryId。
2. 抽取输出扩展为 `supersedesRef` 或 `disputesRef`：服务端将 ref 映射回 related memory 后，验证授权范围。合法 `supersedesRef` 的候选必须由服务端继承目标记录的 namespace/domain/type/subject/canonical path，LLM 只提供新 value、reason 与关系意图，避免要求 LLM 再次生成完全相同的 subject/path；只有允许版本化的同类记录可走 supersedes。`disputesRef` 可指向不同 path 的相关矛盾，但只创建 dispute 关系。未知 ref、越权 ref、类型不兼容或伪造 path 一律拒绝该关系，不影响其他候选。
3. 与既有记忆内容一致的抽取结果**不产出候选**：优先按确定性 suppression key，再做有界语义相似过滤；不得把“是否重复”完全交给 LLM 判断。
4. 反思提示词明确三分类：新事实 / 既有事实的演变 / 与既有事实矛盾；`dispute` 仅停止注入并等待用户或后续反思裁决，不直接篡改旧事实。

**验收标准**：fixture——既有记忆“偏好长回答”，当天对话出现“别再写那么长”：反思产出一条引用合法记录的 `supersedes` 候选而非平行新候选；服务端忽略/拒绝 LLM 自报的替代 path，并继承目标 canonical path；确认后版本链 v+1、旧版归档可查；与既有记忆完全一致的对话内容不产出候选；同一偏好连续 3 天重复表达不产生 3 条重复候选；伪造 ref、跨 namespace ref、类型不兼容的 supersedes 均被拒绝且不会推进版本链；反思测试与 mory 测试全过。

**依赖**：C0；建议先于 T15。

## T13 [P1] 常驻画像块注入（“懂我”的保底）

**现状问题**：注入完全检索驱动（每轮 ≤5 条 × 220 字，`promptInput.ts:18`），检索不命中则模型不知道用户基本盘；并且当前每轮都会重新创建 memory snapshot，尚无可跨 Runner / 进程重启恢复的 session 级画像快照。

**改进目标**：按 C1 第 5 点实现——`prepareTurnMemory` 阶段从 `MemoryProfileBuilder` 稳定层构建约 500 token 画像块。session 首轮把 `profileVersion`、item IDs、渲染文本、base fingerprint、创建时间持久化为独立的 session runtime snapshot；后续 turn 与重启恢复重用相同 base snapshot，不因普通内容编辑而悄然改变会话语义。每轮在 user envelope 序列化前应用 governance revocation overlay：只允许移除已禁注入/争议/休眠/归档/过期条目，不补入新条目；因此安全撤销立即生效，同时 system prompt 保持字节一致。画像有效条目与检索注入去重；预算与开关可配置，群聊/多人场景关闭 owner 合并时不构建 owner 画像。

trace 必须分列 `profile` 与 `retrieved` 项，记录 base fingerprint、被治理层撤销的 item IDs 与实际进入 prompt 的 effective items；只有成功回合才写 usage 信号。

**验收标准**：一轮与既有偏好毫无词汇重叠的对话（检索必不命中），模型输入中仍含画像块内该偏好；没有治理变化时，同一 session 内、Runner 重建后和进程重启恢复后的 base snapshot 与 effective 画像块逐字节稳定；对 snapshot 内条目标记 `too_private` 或 disputed 后，下一轮立即从 effective 画像移除且不自动补位，重启后仍不出现；关闭 owner 合并的群聊不含 owner 画像；另一 Bot/chat 的画像永不越权注入；注入总预算不超配置上限；trace 如实分列 base、撤销项、常驻画像与本轮检索，且重试不重复记 usage。

**依赖**：C0、C1、T10；建议紧随 T10 单独交付。

## T14 [P1] 巩固与遗忘排程（防一年后垃圾场）

**现状问题**：compact 只有手动入口；现有 compact 只合并内容完全相同的记录，`moryConsolidation` 只是纯计算函数，不负责落库、版本链、provenance、状态保留或幂等执行。现有 archive 也意味着从普通 search 中消失，不能同时表示“低权重仍可检索”。

**改进目标**：

1. 新增独立的 Bot/owner 级 `memory-maintenance` watched event JSON，复用现有 runtime 事件、lease、超时与 skipped-vs-concurrent 语义，不经聊天 Runner，也不写 OS scheduler。排程时间默认在每日反思之后，但不依赖反思成功；反思成功后可以 opportunistic 触发一次，仍须与周期事件共享同一 scope lease/idempotency key，避免并发重复。引入 `MemoryMaintenanceService`，先生成可审计、可 dry-run 的 action plan，再执行：过期归档、容量遗忘、精确重复合并与有界降权。pin 记录按策略豁免；privacy-suppressed 记录本身仍可按保留策略归档，但 suppression key 与审计必须独立保留，维护绝不能因归档/合并而恢复注入或重新产生同类候选。维护失败不影响反思候选，反思失败或无新对话也不能阻止维护运行。
2. **长期未使用先降权，不直接删除**：retention 同时使用 `lastInjectedAt` / `injectionCount`、confidence、importance、T11 utility；首先转为 `dormant`，默认不注入，历史/审计可恢复。仅在容量策略或明确过期时 archive；archive 不参与普通 Agent search。
3. **近似重复只提出合并计划，默认不自动合并事实/偏好**：自动执行仅限确定性完全重复；语义近似记录须保留双方 provenance、状态与版本关系，经候选/用户确认后才合并，避免“相似”误作“相同”。
4. 维护结果进入 run 事件（归档、降权、精确合并、待确认近似合并分别计数）；每个 action 具有 idempotency key，崩溃后可安全重跑。

**验收标准**：反思失败、关闭或当天无新对话时，独立 maintenance 仍按 watched event 运行；周期事件与反思后 opportunistic 触发并发时仅一个获得 scope lease，另一个记录 skipped；连续两次执行幂等（第二次无新动作）；过期未 pin 条目被归档，pinned 条目按策略保留；privacy-suppressed 记录即使归档/合并，其 suppression key 仍存在且不会恢复注入或候选；降权条目变为 dormant、默认不进入 search/prompt，但在历史/审计中可恢复；完全重复合并后保留全部来源与 metadata；近似重复只产生可审核计划而非静默合并；维护中断后重跑不双重归档/合并；runlog 含结构化统计。

**依赖**：C0、T11；机制复用 T7 交付物。

## T15 [P1] 候选证据累积与跨 run 聚合

**现状问题**：fingerprint 只在单 RunKey 内去重（速览第 7 条）；跨天重复候选各自新建，"出现 3 次"这一最强的真实性信号被丢弃，Inbox 越堆越烦。

**改进目标**：

1. 跨 run 聚合分两级：只有 namespace/domain/type/canonical path 与 proposition polarity 全部一致的确定性 evidence key 才能**合并进既有候选**——`evidence` 追加去重后的 sources、`occurrenceCount + 1`、confidence 按规则有界上调，不新建行。语义近似只能生成 `possible_duplicate | possible_conflict` 审核关系，不能增加 occurrence、confidence 或触发自动确认；“喜欢长回答”和“不喜欢长回答”必须进入 conflict，而不是合并。来自同一 session、相同消息或同一日期的重复表述不得刷次数。
2. Inbox 按 `occurrenceCount` + confidence 置顶排序，展示“出现 N 次、来自 M 段对话”。
3. 可配置自动确认阈值（默认关闭）：仅允许低敏感 `user_preference` 与明确允许的 project task；`user_fact`、位置/身份、健康/生活方式及其他敏感类型永不自动确认。只有由确定性 evidence key 聚合、无 possible conflict、达到 `occurrenceCount ≥ N`、confidence ≥ x、至少跨两个日期和 session 后，才可走 `gateway.confirmCandidate`；审计标注 `auto`。撤销必须是独立治理动作：归档自动确认产生的版本；仅当其 predecessor 没有后续版本、没有其他 active successor 时才恢复 predecessor，否则进入人工裁决，不能粗暴回滚整条版本链。
4. ignore 语义不变（进 suppression，后续同类不再累积）。

**验收标准**：同一偏好三天、三段不同会话各出现一次 → Inbox 只有一条候选、occurrenceCount=3、三组 sources 可跳转；同一会话内的重复表述不刷次数；正反命题语义近似时 occurrence 均不增加并生成 conflict 审核关系；开启自动确认且满足类型、确定性键、无冲突、跨日期/会话与阈值限制 → 记忆落库且审计标注 auto；撤销自动确认不会覆盖更晚版本；敏感 user_fact 永不自动确认；ignore 后第四天同类内容不再出现。

**依赖**：C0、T12。

## T16 [P1] 会话全文检索工具（第二大脑的"原文找回"）

**现状问题**：记忆层记"结论"，但"我们上个月聊过 X 吗"这类问题需要找回**原文**；Agent 工具目前只有记忆 search，无跨会话 transcript 检索（Hermes 的 `session_search` / SQLite FTS5 是其此能力来源）。

**改进目标**：

1. SessionStore 侧建 FTS 索引（SQLite FTS5；中文按 `moryTokenize` 的 word+bigram 预分词写入，规避 FTS5 默认 tokenizer 对 CJK 的失效）；增量维护，首次提供可中断续跑的后台回填。回填与实时增量共用单调 watermark/change sequence，避免并发期间漏写或复活已删除内容。
2. 新增 Agent 工具 `conversation_search`：输入 query + 可选时间范围/channel/project，输出命中消息片段 + 会话/消息定位（conversationMessageId，可供 UI 跳转）。
3. **权限边界**：抽出共享的 `listAuthorizedConversationSources(scope)`，供 reflection、conversation_search、Desktop external sessions 共用。索引行写入 botId/channel/chatId/projectId/origin/purpose；查询在 SQL 层带这些 allowlist filter，而不是先全文搜索再在应用层过滤。automation/internal/legacy `[EVENT:...]` 会话默认排除。
4. 外部渠道 contexts 投影会话纳入索引，但只索引与现有外部 transcript 投影一致的 user/assistant 展示文本；不得索引原始 JSONL 中的 tool result、system prompt、附件绝对路径或敏感运行内容。
5. **索引生命周期**：会话删除、edit-and-resend 截断、消息内容投影变化、项目/授权范围变化和外部 context 消失必须产生同一 change log/outbox 中的 delete/update tombstone；写源成功但索引更新失败时可重放。定期执行 source-vs-index reconciliation，并提供按 scope/全量重建命令；查询不得返回已删除、已截断或已失去授权的旧索引行。

**验收标准**：中文关键词能命中一个月前某次授权会话中的原文片段并给出可跳转定位；另一 Bot/project、automation/internal/[EVENT] 会话和工具/系统内容均不出现在结果；索引回填可中断续跑，且与实时写入并发不漏消息；新消息写入后可检索（增量延迟有上界）；删除会话、截断旧分支、移出项目授权或删除外部 context 后，旧内容在 tombstone 生效后不可检索；故障后重放与 reconciliation 不会复活已删除内容；agent 测试套件 + tsc 通过。

**依赖**：C0；独立交付。

## T17 [P2] 纠正即时止血

**现状问题**：反思每日一次，用户上午纠正 Agent 后，当天所有会话仍注入错误记忆，修正要到次日凌晨才生效。

**改进目标**：即时链路（现只处理显式“记住”）增加**纠正检测**通道：仅当用户消息命中确定性否定/纠正模式、上一成功回合 effective trace 确实注入过记忆、且消息与该记忆满足 topic 或 lexical/semantic 相关性门槛时，才将相关条目置 `disputed`。`disputed` 通过 T13 governance revocation overlay 立即停止后续注入、进入“需要注意”板块，但不改写内容、confidence 或版本链；细化裁决交给夜间反思（T12 disputes）与用户，一键恢复必须可用。普通入站消息保持零 LLM 调用。

**验收标准**：注入了“偏好长回答”的成功回合后，用户回复“不对，我不喜欢长回答”→ 该记忆立即 disputed、下一轮不再注入；无记忆注入、无相关性或仅含普通否定词的轮次不触发任何动作；disputed 可在 UI 一键恢复；普通入站消息仍零 LLM 调用。

**依赖**：C0、T12、记忆 trace。

## T18 [P2] 程序性记忆 → Skill 提升建议

**现状问题**：morySchema 已有 `skill` 类型、系统已有 skillManage 工具，但"反复出现的成功做法"到"沉淀为可复用 Skill"之间无桥——这是"越用越能干"（区别于"越用越懂你"）的缺口。

**改进目标**：反思/巩固阶段识别有稳定 evidence 的 `skill` 类型记忆，生成“建议沉淀为 Skill 草稿”候选：来源必须包含成功完成的执行记录，而非仅用户陈述；候选只含草拟描述、输入/输出、边界与来源跳转。经用户确认后走既有 Skill draft/review 管理链路创建，**绝不自动创建或直接把普通记忆变成可执行指令**。

**验收标准**：同一操作方法三次被记忆且有两次成功执行证据后，Inbox 出现 Skill 草稿建议（含来源跳转、输入/输出与边界）；确认后按既有 review 规范生成 draft，未确认前不创建可执行 Skill；忽略后同键不再重复建议。

**依赖**：C0、T14、T15。

---

## 端到端验收集（v3 顶层验收）

1. **画像真实且隔离**：>200 条当前 scope 记忆时，半年前确认的 pinned 偏好稳定出现在画像与稳定偏好首位；UI 来源说明与实际选取规则一致；另一 Bot/chat/project 的记忆绝不越权混入，owner 共享只按显式授权发生。（C0 + T10）
2. **反馈生效且隐私默认不可由反馈覆盖撤销**：对一条 trace 中实际注入的记忆标“过于私人”后，它经改 feedback value、compact 与重启也不再出现在任何回答的注入、画像或候选中；只有用户显式执行独立治理恢复动作才能解除；伪造 trace/memory 组合被拒绝。（C0 + T11）
3. **演变闭环**：不含触发词的日常对话中改口一个旧偏好 → 次日 Inbox 出现合法关联的 supersedes 候选 → 确认后新版本注入、旧版本可查。（T12 + 既有版本链）
4. **检索保底、会话稳定且可安全撤销**：与既有偏好零词汇重叠的提问，模型仍知道该偏好（画像块）；无治理变化时同一 session 在 Runner 重建和进程重启恢复后画像块逐字节不变；snapshot 内条目被 privacy/disputed 后下一轮立即移除且不补位。（T13）
5. **维护安全且不依赖反思成功**：反思失败或无新对话时 maintenance 仍运行；中断后可安全重跑；未注入记录不增加 usage；privacy/pin metadata 经维护不丢失；dormant 与 archived 均不进入 prompt。（C0 + T14）
6. **原文找回、授权收敛且删除闭环**：问“我们上个月聊过 X 吗”，Agent 仅从授权会话中找回可跳转原文；其他 Bot、automation/internal、工具与系统内容不泄漏；删除/截断/失去授权的原文不会残留在 FTS 结果。（T16）

## 建议执行顺序

```
批次 0a：C0 授权 scope + provenance 分离、存量迁移
批次 0b：C0 状态/suppression + metadata round-trip
批次 0c：C0 usage 事件 + gateway 审计/outbox
 │
 ├─ 批次 1：C1 + T10（先修复 Desktop 画像真实化；不接 prompt）
 ├─ 批次 1'：T11（append-only 反馈账本 + 可逆 effect，可与批次 1 并行）
 ▼
批次 2：T13（持久化 base snapshot + governance revocation overlay + 常驻画像注入）
 ▼
批次 3：T12 + T15（反思演变，再做跨 run 证据聚合）
 ▼
批次 4：T14（独立 watched event；maintenance dry-run/审计观察后启用写动作）
 ├─ T16 可在 C0a 后独立穿插，但删除/截断 tombstone 必须同批交付
 ▼
批次 5：T17 + T18
 ▼
端到端验收集（六场景全过）
```

派发建议：C0a–C0c 可拆成连续小 PR，但由熟悉 mory、trace、session 的同一负责人守住最终契约；每批必须先在临时数据库完成迁移/幂等/权限回归。C1+T10 同一负责人（共享构建器，避免 UI/服务端再分叉）；T11 可独立；T13 在 C0/C1 完成后独立；T12 的 canonical relation resolver 完成后再接 T15；T14 以独立 watched event + maintenance plan/dry-run 起步；T16 独立但必须包含索引删除生命周期。
