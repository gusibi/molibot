# 记忆使用链路与反馈闭环设计（Memory Usage Trace & Feedback Loop）

- 日期：2026-08-01
- 状态：已交付（2026-08-01），对应 `prd.md` §3.26；实现要点见 `features.md` 同日条目
- 前置文档：[memory-trace-and-memory-center-prd.md](../../requirements/memory-trace-and-memory-center-prd.md)（首版记忆中心 PRD，本文修正其「回答参考」语义在实现中的走样）

## 1. 一句话定义

把「发送时附带给模型的记忆」和「回答时真正参考的记忆」在数据、展示、反馈三层彻底区分开，并让反馈按钮接到真实生效的机制上。

## 2. 背景：现状的三个断层

首版记忆中心上线后，Chat 每条 AI 回复下都挂着「参考了 N 条记忆」，点开面板标题是「本次回答的记忆」。实际链路是：

1. **「参考」是假的。** trace（`src/lib/server/memory/traceStore.ts`）只记录 `injectedItems`（发送时注入）与 `writeReceipts`（写入回执）。系统没有任何机制知道模型回答时用没用某条记忆。「参考了 N 条」统计的其实是「附带了 N 条」。
2. **真参考反而不可见。** Agent 运行中通过 memory 工具（`src/lib/server/agent/tools/memory.ts` 的 `search` / `search_content`）主动检索并读取的记忆——最强的「真参考」信号——完全没有进 trace。
3. **无关注入是必然而非偶发。** 检索排序 `memoryPriority`（`src/lib/server/memory/classifier.ts`）由类别权重主导（collaboration +12、user_preference +11……），词面相关度最多贡献 `scoreLexical × 4`，且 `selectPromptMemoryRows` 没有相关度下限、永远取 topK。对「现在几点」这类低信号提问，排序退化为纯类别权重比大小，同一批高权重记忆对任何问题都固定注入。用户点开面板看到 8 条全不相关，观感是「产品粗糙、bug 多」。

反馈按钮同样空转：「有帮助 / 不应在本次使用」只调 `utility ±0.08`（`gateway.ts` `applyTraceFeedback`），而 `utility` 不参与 `memoryPriority` 排序；遗忘通道（`maintenance.ts`）要求 `injectionCount === 0`，天天被注入的记忆永远够不着。只有「不正确 → disputed」「已过期」「太隐私」三个硬开关真实生效。

## 3. 核心概念：三种使用方式（usage）

| usage | 含义 | 采集方式 | 面板分组 |
|---|---|---|---|
| `injected_profile` | 稳定画像，每轮常驻注入，与提问无关 | 已有（profile 通道） | 本次附带 |
| `injected_retrieved` | 发送时按提问检索注入 | 已有（retrieved 通道） | 本次附带 |
| `referenced` | 回答时真正参考 | **新增**，两个来源见 §4 | 参考记忆（置顶） |

`referenced` 不是第三个注入通道，而是叠加在前两类之上（或独立出现）的标记：一条注入记忆可以同时是 `injected_retrieved` + `referenced`；一条运行中工具查到的记忆是纯 `referenced`（来源 `tool_retrieved`）。

## 4. 「真正参考」的两个采集来源

### 4.1 工具检索命中（tool_retrieved，确定性信号）

Agent 在运行中调 memory 工具 `search` / `search_content` 返回的记忆，视为主动参考。改造点：

- memory 工具执行时把命中记忆的 `memoryId` + 查询词回写进当前 turn 的 trace（trace 需在 run 开始时可被工具层寻址，通过 runner 的 session 上下文传递 traceId 或延迟合并）。
- 记录字段：`source: "tool_retrieved"`、检索 query、命中顺序。
- 无猜测成分，可直接标为 referenced。

### 4.2 注入记忆的引用标注（citation，RAG citation 模式）

- 注入时给每条记忆一个稳定短 ID：`M1`、`M2`……（trace 内保存 shortId ↔ memoryId 映射）。
- 注入块内附一行协议说明：回答实际依据了某条记忆时，在回复末尾追加 `[[mem:M1,M3]]` 标记（一行、聚合、只出现一次）。
- 流式输出末尾解析并剥离该标记（用户永远看不到），被引用的 shortId 解析回 memoryId，写入 trace 标记 `cited`。
- 解析容错：标记缺失 = 无引用（少显示，不误报）；非法 shortId 忽略；标记出现在中途也剥离。
- 明确不做：答案与记忆的词面重叠事后猜测（CJK 场景误判率高，见坑 #7）。

### 4.3 失败模式与语义边界

- 模型漏标 → 该条只显示为「本次附带」，无误报。代价可接受。
- 模型幻标（标了未注入的 ID）→ 忽略。
- `tool_retrieved` 的记忆被查到但未影响答案 → 仍显示在参考组，标注「运行中检索」子标签；这是可解释的（Agent 确实读了）。

## 5. 展示改造

### 5.1 消息关联条（Chat）

- 只在 referenced 集合（cited ∪ tool_retrieved，按 memoryId 去重）非空时显示 chip，文案「参考了 N 条记忆」。
- referenced 为空时**不显示任何 chip**——彻底消灭「每条回复挂同一串假关联」。
- 点击 chip 打开面板并定位到参考组。

### 5.2 右侧面板（MemoryTraceDrawer）

- 标题改为「本轮记忆」。两个分组：
  - **参考记忆**（置顶）：每条标注来源（`cited` / `tool_retrieved` 子标签）+ 记忆创建时间与来源会话（如「来自 7/15 的对话 · 3 周前」）。跨会话老记忆被真实引用并标出，是本设计的核心体验时刻。
  - **本次附带**（折叠、次要）：注入但未被引用的画像与检索项，说明文案「随消息提供给 AI，未必被使用」。
- 「本轮写入」（writeReceipts）分组维持现状。

## 6. 反馈闭环重做

原则：**按钮按 usage 区分语义，且每个按钮必须接到真实生效的机制。**

| 位置 | 按钮 | 效果 |
|---|---|---|
| 参考记忆 | 👍 有帮助 | `utility +0.08`；被引用且获好评的记忆获得遗忘保护与画像排序加分 |
| 参考记忆 | 参考错了 | 强负信号：`utility −0.15`；`memoryPriority` 必须读 utility（见 §7.2）才闭环 |
| 本次附带（画像项） | 别再自动附带 | 直接 `allowInjection = false`（现有字段，注入过滤已尊重），立即生效，记忆中心可恢复 |
| 本次附带（检索项） | 别再自动附带 | `utility −0.08`；同一条累计 3 次后自动 `allowInjection = false` 并在面板提示 |
| 通用 | 不正确 / 已过期 / 太隐私 | 维持现状（disputed / expiresAt / 隐私屏蔽），本来就真实生效 |

幂等与撤销机制（`feedback effect` 的 owns/previous 回滚）沿用现有实现。

## 7. 配套根因修复

### 7.1 检索相关度门槛

`selectPromptMemoryRows` 要求词面/语义相关度过门槛；低信号提问（寒暄、问时间）检索项一条都不注入，只留稳定画像。这是「8 条全不相关」的根因修复，不是 UI 遮丑。

### 7.2 utility 进排序

`memoryPriority` 纳入 `utility` 项（权重与类别分可比但不压倒），使「别再附带 / 参考错了」的累积扣分真实压低排序。

### 7.3 遗忘通道解锁

`maintenance.ts` 的归档条件从 `injectionCount === 0` 放宽为「近 N 天无 referenced 记录且 utility 低」，让被反复注入但从未被参考的记忆也能进入遗忘评估。

## 8. 实施切片

- **Slice 1（可见性）**：trace 补采集（tool_retrieved + citation 协议与剥离）→ 消息 chip 只显真参考 → 面板分组。交付后用户立刻看到真实的「参考」。
- **Slice 2（闭环）**：反馈按钮按 usage 重映射 → utility 进 `memoryPriority` → 检索相关度门槛 → 遗忘条件放宽。

每个 slice 落 `features.md` + `CHANGELOG.md`，验证按惯例：agent 测试套件 + 触及文件 `tsc`；desktop 侧 `svelte-check` 0/0 + `vite build` + UI 测试 + 冷启动走查（坑 #8、#9）。

## 9. 验收标准

1. 问「现在几点」：回复下无记忆 chip；面板打开只见稳定画像归入「本次附带」，参考组为空。
2. 问与旧记忆相关的问题且模型引用：chip 显示真实 N；参考组列出对应记忆并标注来源会话/时间。
3. Agent 运行中用 memory 工具查到的记忆出现在参考组（tool_retrieved 子标签）。
4. citation 标记永不泄漏到用户可见文本（流式与持久化转录都干净）。
5. 「别再自动附带」对画像项立即生效；检索项 3 次后自动禁用注入并提示。
6. 「参考错了」累积后该记忆在同类检索中排序显著下降（utility 参与排序的机器测试）。
7. 反馈幂等/撤销回归、settings/trace 存储 round-trip 回归通过（坑 #10）。

## 10. 风险与开放问题

- citation 协议对弱模型的遵循率未知；上线后用 trace 统计「有注入却零引用」占比，若过高考虑在回复后追加一次廉价的引用判定调用（暂不做）。
- trace 在工具层的寻址（runner → tool 传递 traceId）要避免在 Channel 层泄漏上层逻辑（分层规则）。
- 3 次自动禁用的阈值先写死，后续如需可配置再进 settings（避免过早加配置面）。
