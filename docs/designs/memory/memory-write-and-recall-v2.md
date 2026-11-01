# 记忆写入与读取 v2（Memory Write & Recall v2）

- 日期：2026-10-25
- 状态：五个切片均已交付；真实 Provider（词法 + 向量）验收通过（见 §10）
- 关联：[CONTEXT.md](../reference/CONTEXT.md)、[ADR 0007](../adr/0007-one-memory-write-pipeline.md)、[ADR 0008](../adr/0008-memory-identity-is-subject.md)、[ADR 0001](../adr/0001-memory-namespace-and-turn-retention.md)

## 1. 一句话定义

把两个抽取器、两个提交通道收成一条写入管线；读取端按 `subject` 收敛版本；模型只看到三个意图清晰的工具。

## 2. 现状（为什么改）

| 路径 | 抽取 | 提交 | 主链路自动 |
|---|---|---|---|
| `memory add` | 无 | 直接 active | 依赖模型主动调用 |
| `flush` | 关键词 | 直接 active | 仅 CLI |
| `sessionExtraction` | LLM | proposal | 手动 |
| `reflection` | LLM | proposal | 夜间，产出停在待审 |

结果是：**唯一自动生效的路径是关键词匹配，唯一的智能路径进不了产品。** 读取端 profile（24 条无条件）与 recall（5 条硬词法门槛）互不去重、互不感知版本；低重叠语义矛盾（宝马/特斯拉）两条都 active、都注入。

现有回归 `evals/golden/c-memory.yaml` 的 C1–C3 全部使用“记一下/记住”，正好绕开了这个缺口。

## 3. 目标结构

```
turn / session idle / nightly
        │
        ▼
   Extraction（统一抽取）
        │
        ▼
   MemoryWriter
   normalize → subject → conflict → commit | proposal
        │
        ▼
   Record（active, versioned）
        │
        ├── Profile 通道（稳定画像，按 subject 去重）
        └── Recall 通道（按 query 检索）
                │
                ▼
            Injection
```

## 4. 写入

### 4.1 触发

| 触发 | 时机 | 同步性 | 说明 |
|---|---|---|---|
| 显式 | 用户说“记住”，或模型调用 `save_memory` | 同步 | 不等空闲，直接走 Writer |
| 空闲 | 一轮结束后 debounce 90s | 异步 | 同一会话连续说话只抽一次 |
| 强制 | 单会话 ≥20 轮且距上次抽取 ≥10 分钟 | 异步 | 防止长会话永远不落盘 |
| 启动/周期 | 启动补扫；每 60s sweep | 异步 | 崩溃、关机后补上 |
| 夜间 | 每日反思时间 | 异步 | 调用共享增量入口，遍历全部符合资格的会话，补漏后执行记忆维护 |

幂等以独立的 `MemoryExtractionStateStore` watermark 为准（`conversationId → processedThroughId`），不复用手动“抽取并归档”的 Session receipt：自动管线不能把会话标记成已抽取归档，手动抽取也不能让自动管线跳过它没看过的事实。失败按指数退避（1 分钟起，上限 1 小时），不每轮重试；服务启动时补扫一次，之后随 60 秒维护定时器运行。

`retentionPolicy` 仍然在抽取前过滤，`turn_only` / `not_searchable` / `no_memory` 的消息不进入抽取器（复用现有 `memoryEligible`）。

空闲与每日触发统一调用 `MemoryExtractionService.runSweep`。`conversationId` 筛选单个会话，不传则遍历全部；`target` 可进一步限制 Agent、Bot 和来源范围。`mode: "daily"` 包括活动和归档会话，逐批处理剩余内容；默认空闲模式保留 90 秒静默、长会话触发及每次最多 3 次模型调用。运行中的未完成对话和回收站均不参与抽取，消息仍须满足共享记忆保留策略。

进度保存在 `extraction-state.json`，两种触发只处理同一会话游标之后的消息。每日扫描等待正在运行的抽取，避免并发重复；失败保留成功游标并退避，某个会话失败不阻塞其他会话，任务最终报告失败。首次接入会话沿用最近 80 条的初始化范围，已有游标的后续消息连续分批，通常每批不超过 80 条、24,000 字符；单个完整问答超出限制时保留整个问答，避免截断事实。游标只推进到实际送入抽取器的批次末尾。

迁移不改写旧数据：读取旧每日反思的成功 watermark，与已有共享进度比较后保留较远的位置，再写入共享进度。旧 SQLite watermark 保留，每日素材继续使用其独立按天游标。每日审核可读取空闲抽取产生的待确认候选，无需重新分析对话。

### 4.2 抽取契约

抽取器拿到：会话 tail、相关记录（`relatedMemories`）、profile 摘要。返回：

```json
{
  "memories": [
    {
      "about": "user | agent",
      "domain": "owner | project | agent_self",
      "subject": "user.employer",
      "value": "在字节做 Rust 后端",
      "confidence": 0.86,
      "sensitivity": "normal | sensitive",
      "supersedesSubject": "user.employer"
    }
  ]
}
```

约束：

- 空数组是合法结果，不强迫每轮产出。
- 不得编造未出现的事实；`sensitivity` 与确定性敏感词表取并集（任一命中即敏感）。
- 抽取器失败按指数退避重试（1 分钟起，上限 1 小时）；连续失败不阻塞对话，也不逐轮重试。
- 空闲抽取与每日反思复用同一抽取器、写入规则和会话进度；敏感事实均进入待确认。每日反思逐会话补漏，不额外运行跨会话推断。

### 4.3 提交策略

| 情况 | 结果 |
|---|---|
| 用户显式陈述，非敏感 | 直接 active |
| 推断，非敏感，confidence ≥ 0.5 | 直接 active |
| 推断，非敏感，confidence < 0.5 | proposal |
| 敏感（健康、位置、身份、关系、政治、宗教、性取向） | proposal |
| 无法消解的冲突 | proposal（disputed） |

“显式陈述”由抽取器标记（用户直接说出，而非 Agent 猜测）；模型工具 `save_memory` 视为显式。

### 4.4 Subject 与冲突

- `subject` 由模型给出，服务端规范化为小写 snake_case、去标点；末尾的 `previous/current/old/new/之前/现在` 等限定词会被去掉，限定词只属于 value，不属于身份。
- 抽取前把 **Stable profile + 与本次对话相关的记录** 一起交给模型，并要求它在纠正/演化时复用已有 subject、返回 `supersedesSubject`；服务端以该字段覆盖模型新造的 subject。
- 同 `subject`、值不同 → Revision：新记录 active，旧记录 archived，保留 `supersedes` 链。
- 不同 `subject`、同 domain、embedding 相似度 ≥ 0.92、极性相同 → 合并。
- 不同 `subject`、相似度高、极性相反 → disputed proposal，不能两条都 active。
- 无 embedding 时只执行“同 subject 精确匹配 + 词法近似”两条确定性规则。

读取端：同一 `subject` 只注入最新 active；`disputed`、`archived`、过期记录不注入。

### 4.5 历史数据

不在本轮重写旧记录的 namespace / type（遵循 ADR 0001 与“不保留向后兼容”）。只做 embedding 回填，回填是可重复的数据操作，不是语义迁移。

## 5. 读取

### 5.1 Profile 通道

- 偏好与事实两桶各最多 12 条，先按 subject 去重，再按 `pinned > confidence > utility > updatedAt` 排序。
- 只收 `user_preference` / `user_fact`；`event` / `task` 不进 profile。
- 排除 disputed、archived、过期、`allowInjection=false`。
- 预算按字符估算（CJK 1 字 ≈ 1 token，ASCII 4 字符 ≈ 1 token），不再用 `tokenizeWords().length`。

### 5.2 Recall 通道

- 5 条（现有 `MAX_INJECTED_MEMORIES`）；有 embedding 用语义 + 词法混合，无 embedding 降级纯词法。
- 去掉 `scoreLexical <= 0` 的一刀切；改为“后端综合分低于阈值则返回空”，低信号问题宁可不注入。
- query 用当前用户消息；代词场景由稳定画像兜底（C8 集成用例覆盖），独立的 query 扩展留待后续。

### 5.3 合并与注入

- 两通道按 `subject` 去重，保留 `updatedAt` 更新者。
- Profile 构建、查询选择、注入合并三处都做 subject 收敛，避免同一事实的旧版本从任一通道漏进来。
- 总注入量：profile 两类各 ≤12 + recall ≤5，实际按预算截断。
- 保留现有 `injected_profile` / `injected_retrieved` / `referenced` 语义与 citation 短 ID。

## 6. 工具面

_Slice 3 已交付。_

模型可见只有三个：

```ts
save_memory({ fact, subject?, about? })   // about 默认 user；按 subject upsert
recall_memory({ query })                  // 返回 id + subject + 内容
forget_memory({ id })                     // 只按 id，按 subject 删除留给界面
```

- `save_memory` / `forget_memory` 归类为 write，`recall_memory` 归类为 read：只读/计划模式可以召回，但不能写。
- `forget_memory` 不是普通删除：它删除记录并写入隐私抑制，后续抽取无法重建同一事实。
- 旧的 `disabledTools: ["memory"]` 在设置加载和运行时展开为三个新工具，避免静默恢复写入权限。
- trace 的写入回执与主动检索识别按工具名区分：`save_memory` 产写入回执，`recall_memory` 产 `tool_retrieved` 引用。

移出模型可见面：

- `flush` / `sync` / `compact` → 后台 maintenance 事件。
- `add_content` / `search_content` → 内容导入器与写作界面，不参与对话记忆。
- `set_agent_self` → 由 `save_memory({about:"agent"})` 覆盖。

## 7. Embedding

_Slice 4 已交付。_

- **Embedding lane 是独立配置**（`plugins.memory.embeddingModels`），每条有自己的 `name / baseUrl / apiKey / model / enabled`；`activeEmbeddingModelId` 指向记忆唯一使用的 lane。文本 Provider 不再有 embedding 字段；旧字段只做一次性迁移。
- 目标选择：active lane 有模型时直接使用；否则使用第一条可用 lane；没有可用 lane 时逐条探测并持久化命中的模型。
- 为空时，在启动或设置变更时后台探测常见模型（`text-embedding-3-small`、`bge-m3`、`BAAI/bge-m3`、`qwen3-embedding:0.6b`、`embeddinggemma` 等）；失败按 lane 冷却 1 小时，公开状态显示“当前为词法检索”和最近错误。
- Embedding URL 由 `baseUrl` 推导：base 已带版本段就直接用；否则补 `/v1`，再拼 `/embeddings`。允许直接填写完整 `/embeddings` 端点。避免 `https://api.siliconflow.cn/embeddings` 这类缺少 `/v1` 的 404。
- 设置后后台自动回填，按批返回 remaining，不阻塞启动；模型切换使旧向量失效，按 `embeddingModelVersion` 重嵌入。
- 后台直连 provider 与 embedding 请求同样携带 `x-molibot-session`：依赖 session 头的代理 Provider（cli-proxy → OpenCode）会拒绝缺少该头的抽取/探测请求。
- `/settings/memory/embeddings` 是唯一配置页：多 lane 卡片、独立 Host/Key、测试连接、快速测试、设为 Active、重新索引；记忆页只显示 active 状态、最近错误和入口。`searchAll` 的 all-scopes 搜索与 scoped recall 共用 embedding 路径。
- 本地 Embedding 是可选安装：检测 loopback 上的 Ollama（`/api/tags`）和 LM Studio（`/v1/models`），只展示 embedding 模型；一键加入后生成 `local-*` lane，按模型生成独立 id（同一服务可保存多条）。loopback 免 API Key。未安装/未启动/无模型时不创建 lane，继续远程；active 本地 lane 不可用时自动切换到远程 lane。
- 本地安装示例：Ollama `brew install ollama && ollama serve && ollama pull bge-m3`；LM Studio 下载 Embedding 模型并启动 Local Server。产品不自动安装。

## 8. 降级与失败

| 失败 | 行为 |
|---|---|
| 抽取失败 | `failed` receipt，下一轮 sweep 重试；不阻塞回复 |
| embedding 请求失败 | 冷却期 + 词法降级；UI 显示状态 |
| provider 不可用 | 词法 + profile 继续工作 |
| 冲突无法消解 | disputed proposal，双条都不注入 |

任何情况下都不静默丢数据：写入失败进入 receipt，读取降级在 trace 中可见。

## 9. 观测

- 保留 trace 的三态语义与 citation。
- 新增计数：抽取延迟、pending proposal 数、自动提交率、revision 率。
- 记忆中心按 `subject` 分组展示“我记得你什么”，支持纠正与忘记。

## 10. 验收

**Golden（已加入，真实 Provider 已通过）**

- C5 自然陈述：不说“记住”，跨 session 召回；词法模式 262s、向量模式 255s 通过。
- C6 冲突覆盖：先“开宝马”，后“换特斯拉”，跨 session 只答特斯拉；词法模式 510s、向量模式 507s 通过。
- C8 代词与同义：先“我妻子叫小红，生日 5 月 1 日”，跨 session 问“我老婆生日”能答；词法模式 259s、向量模式 257s 通过。
- 向量真实 Provider：硅基流动 `BAAI/bge-m3` 返回 1024 维；自动探测从 cli-proxy 的 404 回退并写回；零词面重合查询命中目标记忆。
- 本地链路：模拟 Ollama 验证 Ollama/LM Studio 检测、1024 维测试、本地/远程切换、同一本地服务的多条模型 lane、本地服务消失后自动回退、未安装时保持远程；真实本地模型安装后的质量/性能验收未执行。
- 独立页面：迁移旧 Provider 字段、多条远端/本地 lane、独立 Host/Key/Model、Active 切换、删除/空状态、编辑器内测试未保存值；中英/明暗/桌面/移动冷启动截图走查。
- 复现：复制设置到临时 `DATA_DIR`，新建或迁移一条 `BAAI/bge-m3` embedding lane 并设为 Active，用 `MOLIBOT_EVAL_PROFILE_ID=default node evals/run.mjs --id C5,C6,C8 --seed-from <临时目录>` 运行；服务日志应出现 `embedding_ready provider=... model=BAAI/bge-m3`。

**集成/单元（新增）**

- 无关问题：低信号 query 不注入任何 recall 记录。
- 敏感信息：健康类陈述只产 proposal，不产 active。
- Writer 规则：同 subject revision / 跨 subject 合并 / 极性相反转 disputed。
- 读取合并：同 subject 只出最新版本。
- Receipt 幂等：同一 revision 重复 sweep 不重复写入。
- C8：查询与记忆无词面重合时，稳定画像仍注入配偶事实。
- All-scopes 搜索：配置 embedding 后，记忆管理页的跨作用域搜索使用语义结果，而不是退化为词法排序。
- 忘记：删除后同值再次抽取被跳过。
- Embedding 选择：非当前 Provider 的显式模型生效；文本 Provider 探测失败后回退到其他 Provider；endpoint 覆盖 base 带/不带 `/v1` 与 `/api` 前缀。
- 记忆页：Provider/模型选择、测试连接、重新索引、自动检测、最近错误在中英/明暗/移动宽度下可用。

**回归**

- 现有 C1–C4 必须继续通过。
- 新增用例连续运行 5 次全通过，并证明能被对应故障弄失败。

## 11. 已定

1. 历史 pending proposal：保留为 Proposal，记忆中心一次性提示并批量确认/忽略。
2. Desktop 与 Web：Desktop 先全量，Web 补齐 Proposal 审核、subject 分组与忘记。
3. 发布：无 feature flag；`plugins.memory.enabled` 为总开关。
4. 切片：按下列 5 片交付。

## 12. 切片（已交付）

1. **写入管线**：显式 + 空闲抽取 + 自动提交 + watermark 幂等 + C5。
2. **事实身份**：subject 规范化 + revision + 读取合并 + C6。
3. **工具面**：save/recall/forget，移除维护动作。
4. **Embedding**：provider 字段 + 多 Provider 探测/回退 + 自动回填 + 正确 endpoint。
5. **界面与验收**：记忆中心按 subject 展示、Proposal 审核、忘记、独立 Embedding Models 页面（多 lane/独立 Host/Key/测试/重索引/本地可选）、C8 与集成测试。

第 1 片完成即可端到端验证“说一次就记住”，后续每片都建立在前一片可用的基础上。
