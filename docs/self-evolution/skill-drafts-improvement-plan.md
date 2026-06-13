# 技能草稿（Skill Drafts）改进方案

日期：2026-06-13
状态：待评审，暂不改代码
作者：Claude（基于现网代码与磁盘草稿实测）

涉及代码：
- `src/lib/server/agent/skills/skillDraft.ts`（草稿生成 / 合并 / 晋升核心）
- `src/lib/server/agent/skills/skillDraftSubagent.ts`（haiku 子 agent 生成 metadata）
- `src/lib/server/agent/skills/skillDraftMetadata.ts`
- `src/lib/server/agent/tools/subagent-agents/skill-drafter.md`
- `src/lib/server/agent/core/runner.ts`（触发点，约 1921–1956 行）
- `src/lib/server/settings/{schema,defaults}.ts`（`skillDrafts` 配置）
- `src/routes/settings/skill-drafts/+page.svelte`、`src/routes/api/settings/skill-drafts/+server.ts`（UI / API）

---

## 1. 背景与目标

现有"技能草稿"功能的设想：当一次会话**耗时长、调用工具多**时，自动把这次工作流沉淀为一份可复用的技能草稿，供日后晋升为正式技能。

设想是好的，但目前实际效果是：

- **基本没被用到**，处于半废弃状态。
- **草稿爆炸**：磁盘上已沉淀 86 份草稿，绝大多数是一次性事件，不知道何时该用，也没有自动使用。
- **存在一个严重 bug**：86 份草稿里有 85 份的正文是 **Skill Creator 技能全文**，而不是本次工作流的内容。
- 每个合格运行都会额外起一次 LLM 推理，**费 token**。

本方案目标：
1. 定位并修复严重 bug（确定性问题，无产品分歧）。
2. 评估设计理念是否可行。
3. 给出让它**更实用、更省 token**的重构方案，供评审决策。

---

## 2. 严重 Bug：每份草稿都被写入 Skill Creator 全文

### 2.1 根因

不是 "Skill Creator 被当成工具调用"，而是**配置语义与模板填充逻辑撞车**。

用户在设置里配置了：

```jsonc
// <data-root>/settings.json
"skillDrafts": {
  "template": { "skillPath": "<data-root>/skills/skill-creator/SKILL.md" }
}
```

而 `skillDraft.ts` 的 `buildTemplateDrivenBody()`（约 242–261 行）逻辑是：

1. 读取 `template.skillPath` 指向的文件；
2. 按 `#` 标题切分 section；
3. 对每个 section：标题能匹配到标准键（`when to use` / `goal` / `suggested steps` / `流程` / `验证` 等）→ 填入本次运行内容；**匹配不到的 section → 把模板文件那段正文原样抄进草稿**（`section.lines.filter(...)`）。

Skill Creator 的 `SKILL.md` 标题全是 `# Skill Creator`、`# Communicating with the user`、`# Creating a skill`、`# Capture Intent`……**没有一个能匹配标准键**，于是整篇 Skill Creator 正文被逐字内联进每一份草稿。

### 2.2 设计模型错配

`template.skillPath` 的**真实语义**是"一个结构骨架模板，它的正文会被内联进产物"。
用户的**心智模型**是"用 Skill Creator 这个工具去*生成*草稿"。
两者完全不是一回事，所以配错了，且代码也没有防护。

### 2.3 实测证据

- `<data-root>/.../skill-drafts/` 下共 86 份 `.md`；
- 其中 85 份 frontmatter 带 `template_skill_path: .../skill-creator/SKILL.md`，正文为 Skill Creator 全文。

### 2.4 修复方案（确定性，建议立即执行）

**修复 A — 加防护，让"模板"只贡献结构而非正文：**
改 `buildTemplateDrivenBody()`，对**匹配不到标准键**的 section：
- 默认**只保留标题、丢弃模板正文**（产出"待填充"占位），或
- 当模板正文超过阈值（例如非空行 > N）时直接判定为"这不是骨架模板"，整体回退到 `buildDefaultDraftBody()`。

这样即使误配成一个真实技能，也不会把它的正文灌进草稿。

**修复 B — 纠正默认与文档语义：**
- `template.skillPath` 默认空字符串（已是默认，走 `buildDefaultDraftBody`）；
- 在 schema/设置 UI 上明确：此项是"草稿**结构骨架**"，**不应**指向任何真实技能（尤其不是 skill-creator）；
- 仓库内提供一个官方骨架模板文件（只含标准标题、无正文），作为推荐值。

**修复 C — 清理历史污染数据（一次性，需用户确认，不直接删）：**
- 这是**删用户数据**，不属于"无决策"范畴。流程拆成两步：
  1. 先**扫描并输出待清理清单**（哪些文件、`template_skill_path` 指向、正文是否为 Skill Creator 全文），交用户确认；
  2. 确认后再处理。默认动作建议**归档**到同级 `skill-drafts-archive/`（或剥离被内联的 Skill Creator 正文后保留 frontmatter），而非物理删除，便于回滚。
- 多数是一次性事件、价值低，归档后按新机制重沉淀即可。是否改为物理删除由用户决定（见第 6 节开放问题）。

---

## 3. 设计理念评估

**结论：方向成立、有价值，但当前实现有三个结构性问题，导致"废弃感 + 爆炸"。这是实现方式的问题，不是 idea 的问题。**

### 问题一：捕获门槛是"活动量"，不是"可复用性"

`shouldSuggestSkillDraft()`（`skillDraft.ts:434`）的**真实**触发门槛**只有一条**：`toolCalls >= minToolCalls`（默认 4）。

注意：函数在 `skillDraft.ts:449` 先 `if (toolCalls < minToolCalls) return false`，所以走到 452 行的 `return toolCalls >= minToolCalls || recoveredToolFailure || usedModelRetry` 时，第一项恒为真。**`recoveredToolFailure` / `usedModelRetry` 是严格的死代码**，永远无法作为独立触发条件改变结果（`self-evolution.test.ts:104` 的用例也固化了这一行为）。

→ 这意味着两点：
1. 门槛极低，几乎任何稍复杂的对话都会过线。结果沉淀的一半是**调试现场**而非**工作流**（实测草稿名如 `这会是哪里`、`rename-config-file`、`fix-blank-screenshot-missing-url`、`retry-after-fix`）。它在沉淀"活动"，不是"模式"——这是"爆炸"的根本原因。
2. **潜在 bug 待确认**：若原设计本意是"工具失败 / 模型重试即使未达工具阈值也应触发"，则 449 行的提前返回已使该意图失效。是否放宽 449 行让失败/重试可独立触发，作为 P1 的一个独立决策项（见第 6 节）。

### 问题二：正文没有"学习"，是机械拼接

`buildStandardSectionLines()`（`skillDraft.ts:174`）只是把"用户消息 + 工具名列表 + 最终答案截断"塞进固定槽位。真正过 LLM 的只有 name/description（haiku 子 agent，`skill-drafter.md`），**正文完全是字符串组装**。

→ 草稿信噪比低，打开也看不出"该复用什么步骤"，自然没人用。

### 问题三：没有消费闭环

- 草稿写完就躺在目录里；
- `promoteDraftToLiveSkill()` 存在但只能在 UI 手动点；
- 没有自动晋升、没有把草稿/技能喂回后续运行触发链、没有过期回收。

→ 只增不减，最终"不知道什么时候用"。

### 额外：token / IO 成本

- 每个合格运行同步起一次 haiku 子 agent（`buildSkillDraftMetadataViaSubagent`）算 metadata —— 每轮一次额外推理；
- `saveSkillDraft()` 每次保存都遍历读取目录下**所有**已有草稿做相似度比对（`areSkillDraftsSimilar`），是 O(草稿数) 的文件读，随草稿增长越来越慢。

---

## 4. 重构方案

总体思路：**捕获从"每轮活动"改为"复发模式"，生成从"每轮同步推理"改为"定时批量蒸馏"，并补齐"晋升 + 触发 + 回收"闭环。**

### 方案 A：捕获改为"复发触发"（治本，优先级最高）

不再每轮就生成草稿，仅在以下两种情况沉淀：

1. **用户显式表达复用意图**——"把这个变成技能"/"以后都这样做"/"记住这个流程"。可在 runner 里识别意图或提供一个轻量工具/指令。
2. **同类工作流复发 ≥ N 次**（建议 N=2~3）：第一次只记一条轻量运行摘要，复发到阈值才蒸馏成草稿。

   **复发判定不要直接依赖现有 `areSkillDraftsSimilar()`。** 它是对候选消息/描述与已有草稿**全文**做 bigram Jaccard（`skillDraft.ts:344`），本质是"草稿去重/合并"，不是稳定的工作流聚类器；在正文被污染时还会被 Skill Creator 全文干扰，即使修复后也容易误判。建议新增轻量 `workflow_signature` 作为复发判定核心：用户意图类别 + 工具调用序列 + 产物类型 + 成功/失败状态 + bot/chat scope，用它做归并计数；`areSkillDraftsSimilar()` 仅作辅助兜底。

**收益**：一次性调试现场不再沉淀，"爆炸"问题根除；沉淀的都是真正重复出现的流程。

### 方案 B：轻量记录 + 定时批量蒸馏（最省 token，呼应"定时沉淀"诉求）

把"每轮同步蒸馏"拆成两段：

1. **运行时只追加一条极廉价的 run-summary**（工具、结果、用户目标、是否复发计数）——纯字符串，**零额外推理**。可挂在现有 `RunSummary`（`runSummary.ts`）链路上落盘。
2. **定时任务批量蒸馏**：周期蒸馏任务**必须**通过仓库已有的 watched event JSON / `EventsWatcher` / 运行时 event lease 体系注册（`events.ts`、`taskScheduler.ts`、`eventsLeaseStore.ts`），**不得**新增 OS scheduler 或旁路 cron worker（见 `AGENTS.md:62`）。任务周期触发后（如每日一次），对近期 run-summary 做聚类、挑出复发模式，**一次批量 LLM 调用**蒸馏成草稿。

**收益**：token 成本从 O(运行数) 降到 O(定时次数)；批量上下文里能看到多次同类运行，蒸馏质量更高（能真正提炼"稳定步骤 vs 偶发失败"）。

> A 与 B 协同：A 决定"什么该沉淀"，B 决定"何时、以多低成本沉淀"。建议一起做。

### 方案 C：补齐消费闭环（让它真正实用）

1. **晋升（保守优先）**：live 技能会直接改变后续 agent 行为，结合 skill-creator 的最佳实践（正式技能应经人工确认或最小 eval），**第一版只做"高置信推荐 + UI 一键确认晋升"**（复用 `promoteDraftToLiveSkill`），展示草稿质量 / diff 供人工判断。**默认不做全自动晋升**；全自动晋升作为后续开关，且**默认关闭**，等数据证明稳定再开。
2. **接入触发链**：晋升后的技能进入 skill-search / 显式匹配链路，后续运行真的会命中它。
3. **过期回收（TTL/GC）**：从未被匹配、也从未晋升的草稿，超过 TTL 自动归档/删除，杜绝长期堆积。

### 方案 D：性能与数据卫生

- `saveSkillDraft` 的相似度比对改为基于轻量索引（name/description/bigram 指纹缓存），避免每次全目录读盘。
- 一次性清理第 2.4 节的 85 份污染草稿。

---

## 5. 分阶段落地建议

| 阶段 | 内容 | 风险 | 是否需要产品决策 |
|------|------|------|------------------|
| P0a | 改代码：修 `buildTemplateDrivenBody` 防正文内联（修复 A）+ 调整 schema/设置页文案（修复 B，说明是"草稿骨架模板"而非"用某技能生成"） | 低 | 否 |
| P0b | 清理历史数据：输出污染草稿清单 → 确认后归档/剥离（修复 C） | 低 | **是**（删/归档/剥离，见第 6 节） |
| P1 | 捕获改复发触发（方案 A，引入 `workflow_signature`）；并决定是否放宽 449 行让失败/重试可独立触发 | 中 | 是（阈值 N、意图入口、449 行是否放宽） |
| P2 | 轻量 run-summary + 复发计数（先不做 LLM 批量蒸馏） | 中低 | 否 |
| P2.5 | 在 P2 数据基础上加定时批量蒸馏（方案 B，走 watched event / event lease 体系） | 中 | 是（蒸馏频率、事件接入点） |
| P3 | 闭环：高置信推荐 + 一键确认晋升 + 触发链 + TTL（方案 C，自动晋升默认关闭） | 中高 | 是（推荐置信门槛、TTL 时长） |
| P4 | 性能与索引优化（方案 D 前半） | 低 | 否 |

建议落地顺序（采纳 review 意见）：
- **P0a + P0b 先做止血**：P0a 无决策可直接合；P0b 先出清单、确认后再动数据。
- **P1 + P2 一起设计，但实现先只做 P2（轻量记录 + 复发计数）**，先观察哪些 workflow 真复发，避免一上来把系统做复杂。
- **P2.5 定时蒸馏**等 P2 数据证明有复发价值后再加。
- **P3 第一版只做人工审核闭环**（推荐 + 一键确认），自动晋升等数据稳定后再作为默认关闭的开关引入。

---

## 6. 待评审者确认的开放问题

1. **复发阈值 N** 设多少合适？是否区分不同渠道 / bot？
2. **显式复用意图**的入口形式：自动识别用户措辞，还是提供显式指令/工具？
3. **449 行死代码**：是放宽逻辑让"工具失败 / 模型重试"可在未达工具阈值时独立触发（即原设计本意），还是删掉这两个失效开关、明确门槛只看工具数？
4. **定时蒸馏频率与接入点**：每日？每 N 次运行触发一次？挂到 watched event / `taskScheduler` 的哪个事件上？
5. **晋升策略**：第一版人工一键确认（推荐默认）；全自动晋升是否要做、置信门槛多少、默认是否关闭？
6. **历史污染草稿（85 份）处理**：归档（推荐默认）/ 剥离正文保留 frontmatter / 物理删除，三选一？
7. 草稿的**作用域**：目前是 per-bot 目录沉淀。是否需要 global / chat 级别的草稿，以及跨 bot 复用？

---

## 7. 附：关键代码位置速查

- 触发判定：`skillDraft.ts:434` `shouldSuggestSkillDraft()`
- 模板内联 bug：`skillDraft.ts:242` `buildTemplateDrivenBody()`
- 正文机械拼接：`skillDraft.ts:174` `buildStandardSectionLines()`
- 保存与全目录相似度比对：`skillDraft.ts:492` `saveSkillDraft()`
- 晋升：`skillDraft.ts:684` `promoteDraftToLiveSkill()`
- runner 触发点：`runner.ts:1921–1956`
- 配置：`schema.ts:205` `SkillDraftTemplateSettings`、`defaults.ts:251` `defaultSkillDraftSettings`
- metadata 子 agent：`skillDraftSubagent.ts` + `subagent-agents/skill-drafter.md`
