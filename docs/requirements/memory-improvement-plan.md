# 记忆系统改进任务清单（Memory Improvement Plan）

> 日期：2026-07-10
> 背景：产品定位已收敛为「记忆优先、可审计、长期陪伴的个人 Agent」（魔魔计划，见 `market/定位.md`）。对 Harness 记忆链路与 `package/mory` SDK 的审计结论是：**SDK 能力足够，宿主接线不足**——mory 的写入门控、冲突解析、版本链、语义检索在生产路径上大部分被绕过。本文档把审计发现整理为可独立派发的任务，每个任务自带背景与验收标准，供实现 Agent 直接领取。
> 约束：本文档只做规划，不包含实现。实现时每个任务按 AGENTS.md 规则同步更新 `features.md` / `CHANGELOG.md`。

## 现状链路速览（实现前必读）

- 记忆入口统一走 `src/lib/server/memory/gateway.ts`（MemoryGateway），后端可插拔：`jsonFileCore.ts`（JSON 文件）与 `moryCore.ts`（mory SDK + SQLite），注册于 `registry.ts`。
- 每轮对话注入：`agent/core/runner.ts:750` → `turnOrchestrator.prepareTurnMemory` → `gateway.createPromptSnapshot`（limit 12）→ `classifier.selectPromptMemoryRows` 选行 → `prompts/promptInput.ts` 压缩到 ≤5 条、每条 ≤220 字，放进 user 消息的 `<current-memory>` 信封（system prompt 保持字节一致以维持 prefix cache，这个设计要保留）。
- 自动记忆抽取：渠道消息路由 `channels/shared/messageRouter.ts:74` 每次入站消息触发 `flush`，用 `classifier.ts` 的触发词启发式扫 user 消息。
- Agent 工具：`agent/tools/memory.ts`（add/search/list/update/delete/flush/sync/compact）。
- 管理 UI：桌面端 `apps/desktop/src/lib/settings/MemorySection.svelte`（查/改/删/拒绝日志），API `src/routes/api/memory/+server.ts`、`src/routes/api/desktop/memory/+server.ts`。
- 写入治理：`classifier.assessMemoryWrite` 拒绝垃圾写入，拒绝记录落 `governanceLog.ts`。

---

## T1 [P0] 中文分词检索修复

**现状问题**：关键词打分按空格切词，中文 query 整句变成单个 token，命中条件退化为「记忆内容包含整句」，检索质量实际靠时间衰减兜底。共三处：

- `src/lib/server/memory/moryCore.ts:80` `scoreByQuery`
- `src/lib/server/memory/jsonFileCore.ts:44` `scoreByQuery`（与上面是重复代码）
- `src/lib/server/memory/classifier.ts:292` `memoryPriority`（**决定每轮注入 prompt 选哪些记忆**，最容易漏改）

**为什么要改**：主要使用语言是中文；检索和注入选择是「记忆优先」的地基，这里失效则后续所有记忆功能的体感都是「记了但想不起来」。

**改进目标**：中文关键词检索可用。方案约束：

1. **不引入第三方分词库**（jieba 类原生依赖会增加桌面端打包负担）。用 Node ≥22 内置 `Intl.Segmenter("zh", { granularity: "word" })` 做词级切分（取 `isWordLike` 段）。
2. ICU 词典对领域词不完美（实测「调研」被切成「调|研」），需叠加 **CJK 字符 bigram 兜底**：对查询与内容的 CJK 部分生成二字组，按重叠率计分。
3. **停用词降噪**：「的/了/我/又/是」类高频虚词过滤或单字 token 降权，长 token 加权，避免虚词命中全量记忆。
4. **归一化**：`createPromptSnapshot` 的 query 是整条用户消息，长消息 token 多，得按 query token 数归一，防止长消息天然高分。
5. 共享 tokenize/score 模块建议放进 `package/mory`（如 `src/moryTokenize.ts`），宿主三处调用点统一引用，顺便消除两份重复的 `scoreByQuery`；将来切到 `engine.retrieve`（T4）时 SDK 侧检索直接复用。

**验收标准**：

- 查询「短版」能命中内容「主人喜欢短版回复」；查询「调研」能命中含「调研」的记忆（bigram 通道）。
- 纯虚词查询不会把全部记忆打成高分。
- 中英混合查询不回退。补充中文检索单测（两个后端 + `selectPromptMemoryRows`）。

**依赖**：无，可独立先行，属于止血包。

---

## T2 [P0] 记忆路径策略改造（激活 mory 写入管线）

**现状问题**：`moryCore.ts:216` `makePath` 生成的路径含内容 slug + 秒级时间戳（`mory://task/{scope}.{contentSlug}.{stamp}`），每次写入路径几乎必然全新。而 mory 引擎的整条写入管线——`scoreWriteCandidate`、`decideWrite`、`resolveMemoryConflict`、版本推进（`package/mory/src/moryEngine.ts:128` 起，全部基于「按路径查已有记录再决策」）——因为路径永远唯一而**一次都不会真正触发**。去重退化为宿主 `add()` 里的内容全等字符串比对。附带问题：mory 的语义类型（`user_preference` / `user_fact` / `world_knowledge` 等）被压扁成 `task` / `event` 两种，「主人画像」「偏好」在存储层没有身份。

**为什么要改**：这是「可审计」的核心——同一事实的更新应该走版本链（version/supersedes），冲突应该被标记（conflictFlag），观点演变应该可追溯。魔魔文档明确要求「知道你观点如何演变」。现在这套机制是写好但全睡着的死代码。

**改进目标**：

1. 稳定语义路径：`classifier.inferFactKey` 已能推断 `user.preference` / `user.name` / `project.context` 等 key，映射成 `mory://user_preference/answer_length` 式稳定路径；无 factKey 的内容再退回内容派生路径。
2. 类型映射：长期记忆按语义映射到 mory 的 `user_preference` / `user_fact` / `world_knowledge` 等类型，不再统一写成 `task`。
3. 同一事实二次写入应产生 version+1（归档旧版本）而非新路径；矛盾值触发 conflictFlag。
4. 给出现有存量数据的迁移或兼容策略（可以懒迁移，但要明确）。

**验收标准**：对同一 factKey 连续写两个不同值，存储中出现版本链（v1 归档、v2 现役、supersedes 指向 v1）而不是两条并存记录；`engine.ingest` 的 skip/update 分支有单测覆盖真实路径策略。

**依赖**：无。建议在 T4 之前完成。

---

## T3 [P1] LLM extractor 接入 flush（每日对话扫描升级）

**现状问题**：自动记忆抽取是纯触发词启发式（`classifier.ts:180` `classifyAutoMemoryCandidate`，靠「以后/总是/记住/今天」等 hint 列表），且只扫 `role === "user"` 的消息。魔魔计划需要的记忆——主人习惯观察、偏好演变、项目结论、可复用素材——绝大多数不含触发词，抓不到。mory 引擎的 `commit()` 管道原生支持 `extractor` 插槽（`package/mory/src/moryEngine.ts:266`），宿主从未接入。

**为什么要改**：这直接对应魔魔 MVP 第 1、2 项「每日对话扫描 + 今日素材提取」。触发词只能抓「用户显式让记的」，抓不到「值得记的」。

**改进目标**：

1. flush 增加 LLM 抽取通道：将当日增量对话（双方消息，不只 user）送 LLM，产出结构化候选记忆（type / subject / value / confidence / **reason**——为什么值得记，供 T7 审计与 T5 Inbox 展示）。
2. 现有启发式保留为预过滤/兜底（离线可用、零成本）；LLM 通道可配置开关与模型选择（复用 compaction model 的选择机制是现成参考，见 `turnOrchestrator.compactSessionContext`）。
3. 抽取产物走 mory `commit()` 管道（validation → scoring → conflict → versioned persistence），不绕过。
4. 成本控制：按会话游标增量扫描（现有 cursor 机制保留），单次抽取有 token 上限。

**验收标准**：一段不含任何触发词、但明确表达偏好的对话（如「你每次都写太长了」），flush 后能产出一条 `user_preference` 候选记忆且带 reason；LLM 不可用时优雅降级为启发式。

**依赖**：T2（抽取产物需要语义路径与类型）；与 T5 配合（产物应先进 Inbox 而非直写）。

---

## T4 [P1] embedder + engine.retrieve 语义检索

**现状问题**：宿主检索是全量 `list` 后在内存里做关键词+时间衰减打分（`moryCore.ts:226` `scoreAndSlice`）；mory 的 `engine.retrieve`、检索规划器（`moryPlanner.ts`）、L0/L1/L2 分层 promptContext（`moryRetrieval.ts`）全部闲置；embedder 未接线（`capabilities.supportsVectorSearch: false`）。T1 的分词只修「字面重叠」——「他要求精简回复」和「主人喜欢短版」没有共同 token，关键词通道永远救不了。

**为什么要改**：「越来越懂主人」的前提是相关记忆能被想起来。语义检索是记忆优先的真解，分词只是止血。

**改进目标**：

1. 接入 embedding 函数（走现有 provider 体系选一个 embedding 模型；SQLite 本地持久化 + cosine rerank 是 mory 已支持的路径，pgvector 留作后续）。
2. `MoryMemoryBackend.search` 切换到 `engine.retrieve`，关键词（T1 产物）与语义双通道融合打分；`capabilities` 如实上报 `supportsVectorSearch`。
3. 评估注入预算：`prompts/promptInput.ts:15` 目前硬裁到 ≤5 条、每条 220 字，检索质量提升后这个预算可能过于保守，改为可配置（保持「记忆走 user 信封、system prompt 字节一致」的缓存设计不变）。
4. 无 embedding key / 离线时优雅降级到 T1 关键词通道。

**验收标准**：查询「他要求精简」能召回「主人喜欢短版回复」（无共同 token 的语义命中）；embedding 不可用时检索仍工作；新增召回质量对比测试（同一组 fixture，语义通道命中数 ≥ 关键词通道）。

**依赖**：T1（关键词通道）、T2（路径/类型干净后检索分层才有意义）。

---

## T5 [P2] Memory Inbox（候选记忆确认流）

**现状问题**：所有写入（flush 自动抽取、agent 工具 add）直达存储；治理层只有「拒绝日志」（governanceLog 记被拒的），没有「待确认」中间态。魔魔文档把 Memory Inbox 列为 MVP 第 3 项，要求候选记忆支持：保存 / 忽略 / 修改后保存 / 绑定项目 / 绑定 Agent。

**为什么要改**：「不是偷偷记住你，而是让你管理自己的 AI 记忆」是定位里明确的差异化卖点；T3 上了 LLM 抽取后写入量会上升，无确认流会变成噪音积累（长期个性化对话的经典失败模式）。

**改进目标**：

1. 候选记忆状态机：`pending → confirmed / ignored / edited-then-confirmed`；pending 记忆不参与检索与注入。
2. 写入来源分级：用户显式「记住 X」和 agent 工具高置信写入可直通（可配置白名单类别），自动抽取默认进 Inbox。
3. 桌面端 Inbox UI（`MemorySection.svelte` 旁新增或扩展）：展示候选内容 + 来源会话 + reason（T3 产出），支持批量操作；渠道端（Telegram 等）可选推送每日候选摘要卡片。
4. ignored 的内容进抑制名单（复用 `importTombstones.ts` 的思路），避免同一事实反复进 Inbox。

**验收标准**：flush 产生的候选默认不进入 prompt 注入；确认后立即可被检索；忽略后同内容不再出现在 Inbox；操作有 API 与 UI 两个入口。

**依赖**：T3（候选来源）。可与 T3 同一批实现。

---

## T6 [P2] 记忆 scope 维度扩展（owner / project / self / content）

**现状问题**：`src/lib/server/memory/types.ts:1` 的 scope 只有 `channel + externalUserId` 两维：

- **跨渠道隔离**：每轮注入用当前渠道 scope（`turnOrchestrator.prepareTurnMemory`），Telegram 里学到的主人偏好在桌面端对话不出现。「魔魔越来越懂主人」变成了每个渠道各懂一个分身。`searchAll` 存在但只在工具/UI 的 allScopes 参数里用。
- **无项目维度**：app 已有 Projects（ProjectChat/workspace），但记忆与项目没有绑定，魔魔文档要求的「项目记忆」（Molibot 定位讨论、momo-paper 方向等）无落点。
- **无自我/内容记忆**：魔魔的成长阶段、人设边界、已发布内容、用过的梗、禁用重复梗——支撑小红书管线的记忆类别完全没有存储位置。

**为什么要改**：这是魔魔文档 §11 四层记忆（主人画像 / 项目 / 自我 / 内容）与「重复梗检测」的直接前置。

**改进目标**：

1. **owner 级身份**：引入跨渠道的 owner 维度（单用户产品可先做全局 owner + 每渠道映射），主人画像类记忆（user_preference / user_fact）默认 owner 级共享，注入时合并 owner 级 + 渠道级；提供共享开关（群聊等多人场景不共享）。
2. **项目绑定**：记忆可携带 projectId；项目会话注入时优先合并该项目记忆。
3. **自我记忆与内容记忆**：用 mory 路径命名空间表达，不新增存储——`mory://self/...`（成长阶段、人设约束）、`mory://content/published/...`、`mory://content/joke/...`（已发内容、梗使用记录）。内容记忆支持按相似度查询以实现重复梗检测（依赖 T4）。
4. 兼容既有数据：现有 `bot:<slug>:chat:...` externalUserId 编码约定保持可用。

**验收标准**：桌面端确认的主人偏好，在 Telegram 对话的 `<current-memory>` 注入中出现（共享开启时）；项目 A 的记忆不注入项目 B 的会话；能通过查询「这个梗最近发过吗」得到已发内容命中。

**依赖**：T2（路径命名空间）、T4（内容相似度查询）。

---

## T7 [P3] 可审计性补全

**现状问题**：已有 sourceSessionId、创建/更新时间、expiresAt、UI 查改删、拒绝日志——这是好底子。缺三样：每条记忆的「为什么保存」（reason）；溯源只到会话、到不了具体消息；版本历史无 UI 展示（版本链机制在 T2 之前根本没运转）。

**为什么要改**：定位里「可审计记忆」的完整承诺是六问可答：来源哪次对话 / 何时生成 / 为何保存 / 属于哪个项目或 Agent / 是否过期 / 能否删改固定。目前只答得上四问。

**改进目标**：

1. MemoryRecord 增加 `reason` 字段（T3 的 LLM 抽取天然产出；手动/工具写入允许为空）。
2. 溯源精确到消息：sourceSessionId 基础上补 sourceMessageId（flush 扫描时是现成的）。
3. 桌面端记忆详情视图：展示版本历史（T2 激活后 version/supersedes 链）、来源跳转、reason、冲突标记。
4. 支持「固定」（pin，不被 compact/遗忘策略清理）。

**验收标准**：在 UI 中任选一条自动抽取的记忆，能看到：原始对话出处、保存理由、历次版本、过期时间，并能编辑/删除/固定。

**依赖**：T2（版本链）、T3（reason 来源）。

---

## 建议执行顺序与分工

```
T1（独立止血，当天可完成）
  ↓
T2（激活 SDK 写入管线，地基）
  ↓
T3 + T5（抽取 + Inbox，建议同一批：抽取产物直接进 Inbox）
  ↓
T4（语义检索，依赖 T1/T2）
  ↓
T6（scope 扩展，依赖 T2/T4）
  ↓
T7（审计补全，收尾，依赖 T2/T3）
```

每个任务可独立派发给一个实现 Agent；T3+T5 建议合并派发。所有任务实现完成后按 AGENTS.md 规则更新 `features.md` 与 `CHANGELOG.md`，并在本文档标记状态。

## 附：非代码配套任务（不派发实现 Agent，主人自理）

来自定位讨论（`market/定位.md`）的三个待办，与本清单并行：

1. **AIGC 标识合规**：魔魔小红书账号发布前确定 AI 生成内容标识方案，建议把「我是 AI」写进人设而非隐藏。
2. **30 天实验量化标准**：提前定义通过/放弃指标（建议核心指标：「怎么拥有一只」的询问数，而非粉丝数）。
3. **桌面端「一键领养」**：把 apps/desktop 定位为小红书流量的转化出口（普通人走不通「clone 仓库配 key」，走得通「下载 App 领养魔魔」）；此项若立项，另写需求文档。
