# 记忆系统改进任务清单 v2.2（Memory Improvement Plan）

> 日期：2026-07-10（v2.2，同日经三轮外部 review 修订）
> 背景：产品定位已收敛为「记忆优先、可审计、长期陪伴的个人 Agent」（魔魔计划，见 `market/定位.md`）。对 Harness 记忆链路与 `package/mory` SDK 的审计结论是：**SDK 能力足够，宿主接线不足**——mory 的写入门控、冲突解析、版本链、语义检索在生产路径上大部分被绕过。
> v2 变更：采纳第一轮 review 的两个 P0（每日反思不得挂在 per-message flush 上；inferFactKey 不能作为稳定路径主来源）、候选层与 commit 的状态机矛盾修正、domain/type 正交建模、后端决策、统一 tokenizer 全链路化、端到端验收集；T8/T9 拆往独立文档（见文末）。
> v2.1 变更：采纳第二轮 review 的两个 P0——新增 **C0.2 命名空间与身份模型**（namespace 是 mory 的检索隔离键，domain 只管审计与注入策略；否则跨渠道 owner 记忆无法实现）与 **C0.5 反思运行契约**（ReflectionTarget / ReflectionRunKey / watermark / fingerprint 幂等模型）；溯源改为多消息数组并区分内部/平台消息 ID；数据契约纳入 layer/retention；确定性 suppression key 先于语义抑制；T4 增加 namespace 过滤验收。
> v2.2 变更：采纳第三轮 review——反思执行形态改为 watched-event `execution: "internal"` → MemoryReflectionService（**不经普通聊天 Runner，不写会话消息，不向用户外泄反思过程**；通知为成功后的独立步骤）；ReflectionRunKey 补 target 维度（ReflectionTargetId = hash）；候选确认唯一入口 `gateway.confirmCandidate`（编辑后重校验，不得绕过直接 ingest）；新增 ReflectionSourceReader 读取投影（messages + 可选 Summary，只读、可降级）；数据契约补 `lowConfidencePath`，`source.messageId` 残留表述统一为 `sources[]`。
> 约束：本文档只做规划，不包含实现。实现时每个任务按 AGENTS.md 规则同步更新 `features.md` / `CHANGELOG.md`。

## 现状链路速览（实现前必读）

- 记忆入口统一走 `src/lib/server/memory/gateway.ts`（MemoryGateway），后端可插拔：`jsonFileCore.ts`（JSON 文件）与 `moryCore.ts`（mory SDK + SQLite），注册于 `registry.ts`。**记忆插件默认关闭、默认后端 json-file**（`settings/defaults.ts:481`）。
- 每轮对话注入：`agent/core/runner.ts:750` → `turnOrchestrator.prepareTurnMemory` → `gateway.createPromptSnapshot`（limit 12）→ `classifier.selectPromptMemoryRows` 选行 → `prompts/promptInput.ts` 压缩到 ≤5 条、每条 ≤220 字，放进 user 消息的 `<current-memory>` 信封（system prompt 保持字节一致以维持 prefix cache，这个设计要保留）。
- 自动记忆抽取：渠道消息路由 `channels/shared/messageRouter.ts:74` **每次入站消息**触发 `flush`，用 `classifier.ts` 的触发词启发式扫 user 消息。
- 外部导入：`gateway.syncExternalMemories()`（`gateway.ts:244`）把 `backend.add` 直接递给 importer，**绕过 `assessMemoryWrite` 治理与拒绝日志**；importer 自身有删除墓碑检查（`telegramFileImporter.ts:54` 的 `isImportSuppressed`），删除的记忆不会复活，但垃圾写入过滤和未来的候选流都被绕开。
- 会话压缩 Summary：`turnOrchestrator.compactSessionContext` 产出的 Summary 是**会话连续性输入**，不是长期记忆的替代品——它不结构化、不可审计、不进检索。每日反思任务应读取它辅助理解当天脉络，但只把结构化候选写入 Inbox。
- Agent 工具：`agent/tools/memory.ts`（add/search/list/update/delete/flush/sync/compact）。
- 管理 UI：桌面端 `apps/desktop/src/lib/settings/MemorySection.svelte`（查/改/删/拒绝日志）。
- 写入治理：`classifier.assessMemoryWrite` 拒绝垃圾写入，拒绝记录落 `governanceLog.ts`。

---

## C0 [P0] 统一契约（所有任务的前置，实现前必须评审通过）

这一章不是任务，是**契约定义**。T1–T7 的接口都以此为准，实现 Agent 不得自行变更。

### C0.1 后端决策（owner 已决策 2026-07-10）

- **mory 是记忆优先模式的唯一正式后端。** 本清单所有新能力（domain、候选层、审计字段、版本链、语义检索）只在 mory 后端实现。
- **`MemoryBackend` 插拔接口保留**，未来可能接入其他记忆工具（外部记忆服务、云端记忆等）。新契约字段进入 gateway 层类型定义；`capabilities()` 机制扩展为声明式（如 `supportsCandidates`、`supportsDomains`、`supportsVersioning`），新后端按声明接入，gateway 对不支持的能力优雅降级。
- **json-file 后端转维护模式**：保留读取兼容，不实现新能力；提供一次性迁移命令（json-file 存量 → mory），迁移走治理管道（过 `assessMemoryWrite`，可疑条目进候选而非直写）。
- 记忆优先模式下 `plugins.memory.enabled` 默认值翻转为 true、backend 默认 mory 的时机：随 T3+T5 一起发布（有 Inbox 兜底后才敢默认开）。

### C0.2 命名空间与身份模型（v2.1 新增，review P0）

**问题**：mory 的存储、版本链、检索全部按 `userId + path` 隔离（`moryAdapter.ts:59`、`morySql.ts:52`），而宿主把 `channel::externalUserId` 编码成 mory userId（`moryCore.ts:108` `encodeScope`）。只加 domain 列无法实现跨渠道 owner 记忆——Web 和 Telegram 在存储层就是两个 userId；强行统一 userId 又会让 owner / agent_self / content 下的同名路径互相版本冲突。

**契约**：引入 `MemoryNamespace` 作为 mory 的 `userId` / 查询隔离键。**domain 保留为审计与注入策略标签；namespace 才是隔离键。** 版本链在 namespace 内闭合，同名路径跨 namespace 天然不冲突。

| namespace 模式 | 用途 |
|----------------|------|
| `owner:<ownerId>` | 主人画像/偏好（跨渠道共享的记忆） |
| `chat:<botId>:<channel>:<chatId>` | 渠道会话本地记忆（现 `encodeScope` 的后继） |
| `project:<ownerId>:<projectId>` | 项目记忆 |
| `agent:<botId>` | bot 自我记忆（成长状态、人设边界） |
| `content:<botId>` | 已发布内容 / 梗使用记录 |

- **单用户现状**：`ownerId` 固定为常量 `"owner"`，字段保留给未来多 owner。
- **注入由显式 query plan 决定合并哪些 namespace**，不是「按当前 scope 搜一遍」：普通聊天 = `owner` + 当前 `chat` + 当前 `agent`；项目会话追加 `project:<projectId>`；**`content` 绝不自动注入普通聊天**，只能被内容生成任务显式检索。
- **迁移**：存量 `channel::externalUserId` userId 直接映射为 `chat:` namespace（懒迁移）；owner 级记忆通过确认流程 / 整理命令逐步提升（promote）到 `owner:` namespace，不做静默批量搬迁。

### C0.3 数据契约

每条记忆记录（gateway 层类型 + mory 持久化）必须携带：

| 字段 | 说明 |
|------|------|
| `namespace` | 隔离键（C0.2），即 mory `userId` |
| `domain` | 归属标签：`owner` \| `project` \| `agent_self` \| `content`。**与 type 正交**：type 决定写入与检索策略，domain 决定审计与注入策略。不得把归属混进 memory type。 |
| `type` | mory 语义类型（`user_preference` / `user_fact` / `skill` / `event` / `task` / `world_knowledge`，封闭集合，见 `morySchema.ts:27`） |
| `subject` | 稳定主题词（如 `answer_length`、`language`），构成路径的最后一段 |
| `path` | `mory://<type>/<subject>` 规范路径（namespace/domain 不进路径） |
| `lowConfidencePath` | 可选元数据标记（v2.2 补，T2 依赖）：无结构化 type+subject 的兜底写入，内容派生唯一路径时置 true，待反思任务后续合并整理 |
| `value` / `confidence` | 内容与置信度 |
| `layer` / retention | 沿用现有 `long_term` / `daily`。默认：user_preference / user_fact → long_term（长期）；event → daily（可过期）；content 域 → 保留不过期；`pinned` 豁免一切遗忘策略。T7 的遗忘引擎依赖此字段。 |
| `sources[]` | 溯源数组，**一条记录/候选可引用多条消息**。每项：`{ channel, sessionId, conversationMessageId, platformMessageId? }`——`conversationMessageId` 必填（内部稳定 UUID，可跳转本地会话，即 `ConversationMessage.id`）；`platformMessageId` 可选（渠道原始消息 ID，Telegram 等渠道有则存）。注意 `ConversationMessage`（`message.ts:46`）当前没有平台消息 ID 字段，需在渠道入站时新增可选字段并填充（随 T3+T5 批次实现）。 |
| `reason` | 为什么值得记（LLM 抽取产出；用户显式记忆可为 `"user_explicit"`） |
| `expiresAt` / `pinned` | 过期与固定 |

### C0.4 写入入口状态机（三个入口，三条路径）

```
入口 1：用户显式「记住 X」/ agent 工具 add
  → gateway.add 治理（assessMemoryWrite）→ 直写 mory（reason="user_explicit"）

入口 2：每日反思 LLM 抽取（T3）
  → validate → MemoryCandidate(pending)【独立候选层，不写 mory】
      → 用户 confirm → gateway.confirmCandidate（唯一确认入口，见下）
      → 用户 ignore  → suppression 名单（同类内容不再进候选）

入口 3：外部 importer（syncExternalMemories）
  → 收编进 gateway 治理：至少过 assessMemoryWrite + 拒绝日志；
    默认进候选层，白名单来源可配置直写
```

关键约束：

- **pending 候选绝不写入 mory**（不参与检索、注入、版本链），否则版本链和审计被污染。候选层是独立存储（表或文件均可，带自己的状态字段）。
- **suppression key 先用确定性定义**（v2.1，review P2）：`namespace + domain + type + subject + normalizedValue`（normalize 复用 T1a tokenizer 的归一化），T5 落地时即可用，不依赖 T4；T4 完成后再增强为语义近似抑制。
- **候选确认的唯一入口是 `gateway.confirmCandidate(candidateId, edit?)`**（v2.2，review P1）：reload pending 候选 → revalidate（用户编辑过的内容、namespace、domain、来源全部重新校验）→ 应用 suppression / namespace 策略 → `mory.ingest` → 原子标记 confirmed。任何 UI / API / 渠道入口都不得绕过它直接 ingest——否则编辑后的候选会带着未校验的内容进入版本链。

### C0.5 反思运行契约（v2.1 新增，v2.2 补执行形态，review P0 ×2）

每日反思不是「对着一个 chatId 跑一次」——定时事件天然只有一个 `chatId`，而 `prepareTurnMemory()` 也只接受 `channel + chatId`（`turnOrchestrator.ts:309`），都不能表达「某个 owner 的跨渠道对话集合」。

**执行形态（v2.2，review P0）**：反思**不得使用现有 `delivery: "agent"` 执行**——该路径把事件文本作为会话消息保存（`baseRuntime.ts:471` `appendConversationMessage`），并把模型输出通过渠道 response 发回用户，会导致反思提示词污染会话上下文、抽取过程外泄。新增 watched-event 执行模式：

```
watched-event JSON
→ execution: "internal"
→ MemoryReflectionService（共享上层执行，不经普通聊天 Runner）
→ Candidate Inbox + structured run event（runlog 可观测）
```

- internal 运行不生成任何普通会话消息、不自动向用户发送任何内容；
- 「今日有 N 条候选记忆」这类提示是反思**成功后的独立通知步骤**（可复用现有事件的 text 投递），与执行本身解耦。

**标识与幂等**（v2.2 修正：RunKey 必须含 target 维度——同 owner 多 bot、或同 bot 多套 source scopes 时，各自拥有独立的幂等键、watermark 关联与候选去重边界）：

```
ReflectionTarget   = ownerId + botId + timezone + source scopes（明确扫描哪些渠道/会话）
ReflectionTargetId = hash(ownerId + botId + timezone + canonicalSourceScopes)
ReflectionRunKey   = ReflectionTargetId + localDate（按 target 的 timezone 计算）
```

幂等与失败语义：

- 每个 source conversation 有**独立 watermark**（沿现有游标机制升级，与 RunKey 关联）；
- **候选写入成功后才推进 watermark**；被 stop / timeout 的 run 不推进 watermark（下次重跑覆盖同批消息）；
- 每条候选带 **fingerprint**：`sources 消息 id 集 + domain + type + subject + normalizedValue`；
- 同一 `ReflectionRunKey` 的重试按 fingerprint 去重，**不会重复创建候选**。

**读取投影（v2.2，review P1）**：反思输入经 `ReflectionSourceReader` 契约获取——每个 source scope 返回 `{ messages（当天增量，来自 SessionStore）, latestSummary?（来自 Agent context/session 存储，不在 SessionStore 里） }`。Summary 缺失时正常降级（只用 messages）；读取是**只读投影**，不得为取 Summary 回灌或改写聊天上下文；全程不经 `prepareTurnMemory`。

### C0.6 Summary 的定位

会话压缩 Summary 是会话连续性输入，服务于「本会话还能继续聊」；长期记忆服务于「跨会话跨渠道还记得你」。每日反思（T3）读取当天 Summary 作为辅助上下文，但产出只能是结构化候选，Summary 本身永不直接落记忆。

---

## 端到端验收集（顶层验收，全部任务完成后必须通过）

单点断言不足以证明产品目标，以下四条固定场景是「长期陪伴」的最终验收：

1. **跨渠道**：Web 中确认的主人偏好，Telegram 会话的 `<current-memory>` 注入中出现（共享开启时）。（依赖 T6a）
2. **演变可追溯**：主人把「偏好长回答」改为「偏好短回答」，新版本立即生效，旧版本在版本链中可查。（依赖 T2）
3. **反思不越权**：每日反思从一段**不含任何触发词**的对话中提取出候选；候选在未确认前，对任何会话的回复零影响。（依赖 T3+T5）
4. **内容防重**：已发布的吐槽内容再次生成时，能召回相似历史内容并提示重复风险。（依赖 T4+T6b）

---

## T1a [P0] 中文分词止血（宿主三处，立即可做）

> **状态：已完成（2026-07-10；分词器于 2026-07-17 升级）。** `package/mory/src/moryTokenize.ts` 落地；word 通道当前使用 `jieba-wasm` 的 Jieba search mode，并保留 CJK bigram、停用词/单字降权和 query 归一，经 `index.ts` 导出。三处调用点已切换（moryCore / jsonFileCore 的 `scoreByQuery` 委托 `scoreLexical`，classifier `memoryPriority` 的 token 循环替换为 `scoreLexical × 4`）。验收：mory 全量 186 项通过（含 Jieba 词项、bigram、纯虚词零分和中英混合）；宿主 classifier 与 Session 会话索引生命周期回归通过。

**现状问题**：关键词打分按空格切词，中文 query 整句变成单个 token，命中退化为整句子串匹配。三处：`moryCore.ts:80`、`jsonFileCore.ts:44`（重复代码）、`classifier.ts:292` `memoryPriority`（**决定每轮注入选哪些记忆**，最容易漏改）。

**改进目标**：新建共享 tokenize/score 模块 **`package/mory/src/moryTokenize.ts`**（从第一天就放 SDK 内，T1b 直接复用）：

1. 使用 `jieba-wasm` 的 Jieba search-mode 分词；WASM 随普通 production dependency 发布，不依赖 node-gyp 或平台 optional binary，兼容 Desktop 的 `--no-optional` 打包流程。
2. Jieba 对未登录领域词仍可能切分不理想，因此叠加 **CJK 字符 bigram 兜底**，保证历史索引和未知词召回。
3. 停用词/单字降权，长 token 加权。
4. 按 query token 数归一（`createPromptSnapshot` 的 query 是整条用户消息）。

宿主三处调用点统一引用，消除两份重复 `scoreByQuery`。

**验收标准**：「短版」命中「主人喜欢短版回复」；「调研」经 bigram 通道命中；纯虚词不produce全量高分；中英混合不回退；两个后端 + `selectPromptMemoryRows` 各有中文单测。

**依赖**：无。可在 C0 评审期间并行完成。

## T1b [P1] mory 全链路统一 tokenizer

> **状态：已完成（2026-07-11）。** mory retrieval、write gate、冲突与 consolidation 已统一复用 CJK word+bigram tokenizer；同稳定路径不再由措辞相似度决定身份。

**现状问题**：T4 切到 `engine.retrieve()` 后不会自动继承 T1a——`moryRetrieval.ts:48` 用自己的 jaccard/overlap `lexicalScore`，`moryWriteGate` 的去重/冲突相似度判定也有独立实现。不统一则 T1a 修好宿主检索、T4 接管后又退回弱中文匹配。

**改进目标**：`moryTokenize.ts` 成为 mory 唯一分词与相似度来源，四个消费点强制接入：宿主关键词检索、`classifier` prompt 行选择、`moryRetrieval` 的 lexical 通道、`moryWriteGate` 的写入去重与冲突判定。

**验收标准**：同一组中文 fixture 在四个消费点得到一致的命中/去重行为；moryRetrieval 对中文查询的 lexical 召回不低于宿主 T1a 通道。

**依赖**：T1a（模块本体）；建议在 T4 之前完成。

## T2 [P1] 稳定路径与版本链激活

**现状问题**：`moryCore.ts:216` `makePath` 用 content-slug+时间戳，路径必然唯一 → mory 写入管线（`scoreWriteCandidate` / `decideWrite` / `resolveMemoryConflict` / 版本推进，`moryEngine.ts:128` 起均按路径查已有）**一次都不会触发**；类型全被压扁为 `task`/`event`。

**v2 修正（review P0）**：稳定路径的**主来源是 extractor 的完整结构化输出**（C0.3 契约：domain + type + subject + path），不是 `inferFactKey`。`classifier.ts:162` 的 `inferFactKey` 只能产出 `user.preference` 级粗分类，推不出 `answer_length` 这类 subject——如果把所有偏好映射进一个共享路径，「喜欢简洁」会**版本覆盖**「喜欢中文」，比时间戳路径更危险。

**改进目标**：

1. 路径主来源：凡带完整 `type + subject` 的写入（T3 反思候选确认、显式结构化 add），使用 `mory://<type>/<subject>` 稳定路径，同一事实更新走版本链（version+1、归档旧版、supersedes 指向）、矛盾值触发 conflictFlag。**版本链在 namespace（C0.2）内闭合**，同名路径跨 namespace 互不冲突。
2. **inferFactKey 降级为低置信兜底**：仅用于无结构化信息的写入（手动纯文本 add、即时链路），且兜底时**不得落共享稳定路径**——继续用内容派生唯一路径并标记 `lowConfidencePath`，宁可查不到，不可错误覆盖。后续可由反思任务合并整理。
3. 语义类型映射：不再统一写 `task`；`namespace` / `domain` 按 C0.2 / C0.3 落地（配合 T6a）。
4. 存量数据迁移策略明确（可懒迁移：读到旧路径记录时不动，新写入走新规则；提供手动整理命令）。

**验收标准**：对同一 `type+subject` 连续写两个不同值 → 版本链（v1 归档、v2 现役）而非并存；对两个不同 subject 的偏好连续写入 → 两条独立路径，**互不覆盖**；无 subject 的纯文本 add → 唯一路径 + lowConfidencePath 标记；`engine.ingest` 的 skip/update/conflict 分支在真实路径策略下有单测。

**依赖**：C0（extractor 输出 schema）；与 T6a 同批（domain 列一起动 schema）。

## T3 [P1] 双链路抽取：即时链路 + 每日反思

> **状态：已完成（2026-07-11）。** 即时链路仅保留显式记忆；每日反思走 internal watched event、只读 source projection、独立 watermark/fingerprint，并支持 Web/Project 与外部渠道 context transcript。反思时间可在 Desktop 配置；产生新候选后向该 Bot 的首个允许聊天发送独立完成通知，空结果保持安静。

**v2 修正（review P0）**：v1 把 LLM 抽取挂在 `flush()` 上，而 `flush` 在**每条入站消息**时执行（`messageRouter.ts:74`）——那会变成每条消息一次模型调用：延迟、成本、游标竞争、碎片候选，且不符合「每日反思」的产品语义。改为两条链路：

**即时链路（保持廉价）**：

- 只处理显式记忆意图（`REMEMBER_HINTS`：「记住/记一下/remember」），走入口 1 直写（带治理）。
- 现有启发式的 DURABLE/DAILY 泛化匹配从 per-message flush 中**移除**（这类内容交给每日反思），`flush` 的语义收窄为「显式记住 + 游标推进」。

**每日反思链路（新增，产品核心）**：

- **载体（v2.2 修正，review P0）**：watched-event 定时任务（`agent/events.ts`）+ 新增 `execution: "internal"` 模式 → `MemoryReflectionService`，**不经普通聊天 Runner**。禁止用现有 `delivery: "agent"`——它会把事件文本存为会话消息并把输出发回渠道（`baseRuntime.ts:471`），反思过程会污染会话并外泄给用户。默认每日一次（时间可配）。「今日 N 条候选」提示走反思成功后的独立通知步骤（可复用事件 text 投递）。
- **扫描对象与幂等严格遵循 C0.5 反思运行契约**（v2.1）：按 `ReflectionTarget`（ownerId + botId + timezone + source scopes）确定扫描范围，直接从 SessionStore 拉取各 source conversation 的当天增量（不经 `prepareTurnMemory`，它只接受单个 channel+chatId）；每 conversation 独立 watermark，候选写入成功后才推进，stop/timeout 不推进；候选带 fingerprint，同一 `ReflectionRunKey` 重试不重复建候选。
- 输入：经 `ReflectionSourceReader`（C0.5 读取投影）获取——当天增量对话 + 可选的近期会话 Summary（辅助理解脉络，见 C0.6，缺失时降级）+ 既有相关记忆（供判断新旧与演变）。
- 输出：结构化候选（C0.3 完整字段：namespace/domain/type/subject/path/value/confidence/reason/sources[] 含 conversationMessageId 与可选 platformMessageId）→ **写入 Candidate Inbox（入口 2），绝不直接 `engine.commit()`**。
- 渠道入站管道：为 `ConversationMessage` 增加可选 `platformMessageId` 字段并在各渠道入站时填充（C0.3 溯源要求，Telegram 等渠道有原始消息 ID）。
- 成本控制：单次反思 token 预算上限；模型选择复用 compaction model 的配置机制（参考 `turnOrchestrator.compactSessionContext`）。
- 降级：LLM 不可用时**跳过本日并告警**（watermark 不推进，次日补扫），不退回启发式批量写入（宁缺毋滥）。

**验收标准**：一段不含触发词但明确表达偏好的对话（「你每次都写太长了」），当日反思后 Inbox 出现一条 `user_preference` 候选，带 reason 与 sources（可跳转到具体消息）；反思运行期间与之后，候选对任何会话回复零影响（端到端场景 3）；普通入站消息不产生任何 LLM 调用；**同一 ReflectionRunKey 连续跑两次，候选数量不变**（fingerprint 去重）；**运行中途 abort 后 watermark 未推进，重跑能覆盖同批消息且不产生重复候选**；**反思运行全程不产生任何会话消息、不向用户渠道发送内容**（成功后的独立通知步骤除外），会话历史与反思前逐字节一致。

**依赖**：C0、T5（候选层是落点，**必须同批实现**）。

## T5 [P1] Candidate Inbox（独立候选层 + importer 收编）

> **状态：已完成（2026-07-11）。** Candidate SQLite、唯一 confirm 入口、编辑重校验、ignore suppression、importer 治理收编及 Desktop Inbox 已交付。

**v2 修正（review P1）**：v1 的 T3 说「走 commit() 不绕过」、T5 说「先进 Inbox」，互相矛盾——`engine.commit()`（`moryEngine.ts:266`）会直接持久化。候选层必须**独立于 mory 存储**，confirm 后才 `mory.ingest`。

**改进目标**：

1. **MemoryCandidate 独立存储**（自有表/文件，字段=C0.3 全集 + status + fingerprint）：`pending → confirmed / ignored / edited-then-confirmed`。pending 不参与检索、注入、版本链。
2. confirm → 经 **`gateway.confirmCandidate(candidateId, edit?)`**（C0.4 唯一确认入口：reload → revalidate → 策略 → ingest → 原子确认；编辑过的候选必须重新校验）写入候选所属 namespace（此时 T2 的路径/版本链才介入）；ignore → 进抑制名单，**抑制键用 C0.4 的确定性定义**（`namespace+domain+type+subject+normalizedValue`，不依赖 T4；T4 后增强为语义近似抑制）。
3. 直写白名单：入口 1（显式记住、agent 工具高置信 add）不经候选，可配置收紧。
4. **importer 收编（review 补充发现，已核实并修正表述）**：`syncExternalMemories` 现在把 `backend.add` 直接递给 importer（`gateway.ts:251`），绕过治理与拒绝日志——删除墓碑已有（`telegramFileImporter.ts:54`），删除不会复活，但垃圾过滤被绕开。改为：importer 产物统一过 `assessMemoryWrite`，默认进候选层，白名单来源可配直写。
5. **最小审计字段并入本批（review P2：T7 不应全放最后）**：`reason`、`sources[]`（conversationMessageId 必填 + platformMessageId 可选，见 C0.3）、候选状态是 Inbox 可信的地基，随 T3+T5 落库；版本历史 UI 等留给 T7。
6. UI：桌面端 Inbox（确认/忽略/编辑/绑定 domain 与 project，批量操作）；渠道端可选每日候选摘要卡片。

**验收标准**：反思候选默认不进任何 prompt 注入；confirm 后立即可检索且 mory 中出现带完整溯源字段的记录；ignore 后同类内容不再出现在 Inbox；importer 导入的可疑条目出现在 Inbox 而非直写；桌面 UI 与 API 双入口可操作。

**依赖**：C0、与 T3 同批派发。

## T4 [P2] embedder + engine.retrieve 语义检索

> **状态：已完成（2026-07-11）。** engine.retrieve 支持显式多 namespace/domain 过滤；可配置 OpenAI-compatible embedding provider/model、模型版本回填与离线 lexical 降级已接入。

**现状问题**：宿主 search 是全量 list + 关键词/时间打分（`moryCore.ts:226`），`engine.retrieve`、检索规划器、L0/L1/L2 promptContext 闲置；embedder 未接。分词只修字面重叠，「他要求精简回复」vs「主人喜欢短版」无共同 token。

**改进目标**：

1. 接入 embedding（走 provider 体系选型；SQLite 本地持久化 + cosine rerank 是 mory 已支持路径），**记录 embedding 模型版本**（换模型时可识别需重算的行）。
2. **存量回填**：为既有记录批量补 embedding（后台任务，可中断续跑）。
3. `MoryMemoryBackend.search` 切到 `engine.retrieve`，lexical 通道**必须走 T1b 统一 tokenizer**（防止中文匹配回退），语义与关键词双通道融合。
4. **namespace/domain 过滤进入 retrieve 接口**（v2.1，review P1）：`RetrieveOptions` 现无任何隔离过滤参数（`moryRetrieval.ts:11`），需增加 namespaces（多选）与 domain/pathPrefix 过滤（`StorageAdapter.ListOptions` 已有 `memoryTypes`/`pathPrefixes` 钩子可扩展）；检索按 C0.2 的 query plan 显式合并 namespace，**不做「全库搜一遍」**。
5. 注入预算可配置（`promptInput.ts:15` 现硬裁 ≤5 条/220 字），保持记忆走 user 信封的缓存设计。
6. 无 embedding key / 离线时降级到 T1 关键词通道，`capabilities` 如实上报。

**验收标准**：「他要求精简」召回「主人喜欢短版回复」（无共同 token）；中文 lexical 召回不低于 T1a 水平（回归测试）；embedding 不可用时检索仍工作；回填任务可中断续跑；**普通聊天只检索 `owner` + 当前 `chat` + 当前 `agent` namespace，项目会话额外检索当前 `project`，`content` namespace 绝不出现在普通聊天的注入中**（仅内容生成任务显式检索）。

**依赖**：T1b、T2。

## T6a [P1] Namespace 与 Domain 模型落地（owner / project / agent_self / content）

**v2 修正（review P1）**：v1 说「用 mory 路径命名空间表达、不新增存储」不成立——`MemoryType` 是封闭集合（`morySchema.ts:27`），`moryValidation.ts` 会把未知类型归回默认逻辑。
**v2.1 修正（review P0）**：只加 domain 列也不成立——mory 按 `userId + path` 隔离，宿主现把 `channel::externalUserId` 编成 userId，Web 和 Telegram 在存储层就是两个宇宙，domain 标签无法跨越；强行同 userId 又会让不同归属的同名路径版本冲突。**隔离靠 namespace（C0.2），domain 只做审计与注入策略标签。**

**改进目标**：

1. **namespace 落地为 mory userId**（C0.2 编码规则）：存量 `channel::externalUserId` 映射为 `chat:<botId>:<channel>:<chatId>` namespace（懒迁移，读旧写新）。
2. `domain` 列与 namespace 同批加入 mory schema 与 gateway 类型（一次 schema 变更，与 T2 合批）。
3. **owner 跨渠道**：确认后的主人画像类记忆（user_preference / user_fact）写入 `owner:<ownerId>` namespace；注入按 C0.2 query plan 合并 `owner` + 当前 `chat`（+ 当前 `agent`）；提供共享开关（群聊等多人场景不合并 owner）。
4. **project 绑定**：项目会话的 query plan 追加 `project:<ownerId>:<projectId>`；项目 A 的记忆不出现在项目 B 会话。
5. `agent:` / `content:` namespace 先建立编码与写入路径，应用逻辑在 T6b。
6. Inbox（T5）确认时支持选择目标 namespace（默认按候选的 domain 推荐：owner 画像 → owner，当日事件 → chat）。

**验收标准**：端到端场景 1（Web 确认、Telegram 注入）通过；项目隔离通过；不同 namespace 下同名路径（如 `mory://user_preference/tone` 在 owner 与某 chat 各一条）互不覆盖、版本链各自独立；存量数据懒迁移无破坏。

**依赖**：C0；与 T2 同批（一次 schema 变更）。

## T6b [P2] 内容记忆与自我记忆应用

> **状态：已完成（2026-07-11）。** Agent Memory 工具提供显式 content 检索/写入与 agent_self 结构化写入；content 保持普通聊天零注入。

**改进目标**：

1. `content` 域应用：已发布内容记录（发布时间、渠道、栏目、用过的梗）、**重复梗检测**——生成新内容前按相似度查询 content 域（依赖 T4 语义检索）。
2. `agent_self` 域应用：魔魔成长阶段、人设边界、主线任务进度的结构化存取接口。

**验收标准**：端到端场景 4（已发内容防重）通过；成长阶段可读写并出现在反思任务的输入上下文中。

**依赖**：T4、T6a。

## T7 [P2] 可审计补全（收尾）

> **状态：已完成（2026-07-11）。** Desktop 展示 reason/sources/版本/conflict/pin，来源可定位到对话消息；compact 接入过期、容量遗忘与 pin 豁免。

**范围（v2 调整）**：`reason` / `sources[]` / 候选状态已前移到 T3+T5，本任务收尾剩余部分：

1. 桌面端记忆详情视图：版本历史（T2 版本链）、来源跳转（sessionId+messageId → 会话定位）、conflictFlag 展示。
2. `pinned` 固定（不被 compact / 遗忘策略清理）。
3. 遗忘与过期策略接入 mory 的 `moryForgetting`（现闲置）：daily 层过期、低 utility 归档，pin 豁免。

**验收标准**：任选一条自动抽取的记忆，UI 中能看到原始对话出处（可跳转）、保存理由、历次版本、过期时间，并能编辑/删除/固定；六问全部可答（来源哪次对话/何时/为何/属于哪个域与项目/是否过期/能否删改固定）。

**依赖**：T2、T3+T5。

---

## 建议执行顺序与分工（v2）

```
C0  契约评审（文档层面，先于一切实现）
 │
 ├─ T1a 宿主分词止血（无依赖，评审期间即可并行完成）
 │
 ▼
批次 1：T2 + T6a（稳定路径 + namespace/domain 模型，一次 schema 变更，版本链真正可触发）
 ▼
批次 2：T1b（mory 全链路统一 tokenizer）
 ▼
批次 3：T3 + T5 + 最小审计字段（每日反思 + Candidate Inbox + reason/messageId；
        完成后翻转 memory 默认开启 + mory 默认后端，提供 json-file 迁移）
 ▼
批次 4：T4（embedding、回填、模型版本、语义检索与降级）
 ▼
批次 5：T6b + T7（内容防重、成长状态、版本历史 UI、pin、遗忘策略）
 ▼
端到端验收集（四场景全过）
```

派发建议：T1a 单独一个小任务；批次 1 一个 Agent；T3+T5 必须同一个 Agent（状态机不可拆）；其余按批次派发。

## 已拆出的关联任务（不在本清单范围内）

- **T8 Subagent 信息采集能力** → `docs/requirements/content-collection-pipeline.md`（内容采集与成长日志管线）。记忆 MVP 不依赖它。
- **T9 Project 级技能加载** → `docs/requirements/project-skills-loading.md`（平台任务，与记忆无耦合）。

## 附：非代码配套任务（不派发实现 Agent，主人自理）

1. **AIGC 标识合规**：魔魔小红书账号发布前确定 AI 生成内容标识方案，建议把「我是 AI」写进人设而非隐藏。
2. **30 天实验量化标准**：提前定义通过/放弃指标（建议核心指标：「怎么拥有一只」的询问数，而非粉丝数）。
3. **桌面端「一键领养」**：把 apps/desktop 定位为小红书流量的转化出口；此项若立项，另写需求文档。
