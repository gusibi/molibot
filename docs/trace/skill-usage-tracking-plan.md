# Skill 调用追踪方案（Skill Usage Tracking）

> 目标：在现有 trace 体系里，把 **Skill 的触发 / 加载 / 执行** 变成可观测、可统计、可审计的事实（fact），补齐当前唯一缺失的追踪维度。
>
> 本文为实现方案，供 review。**结论先行**：基础设施已基本就绪，缺的是「事件来源」。建议分三个 Phase 落地，Phase 1 用一个已经在流动的信号堵住最大窟窿。

> **修订记录（rev.2 接线缺口）**：第一轮 review 指出并经源码核对属实的 4 个接线缺口（搜「⚠️」）：
> 1. `tool.call.after` payload **不带 args** → 不能在 after 解析 `args.path`（见 3.1）。
> 2. 独立 observe hook **缺 `workspaceDir/cwd` 与 skill 列表** → Phase 1 先在 runner 内落地（见 3.1）。
> 3. `skillSearch` 工具**无 emit 入口** → Phase 2 在 runner `afterToolCall` 读 `details.matches`（见 Phase 2）。
> 4. `recordSkillFact` / `SqliteTraceStore` **无读旧 fact 合并能力** → 新增 `skillUsageState` 或 `getFactByKey` + 稳定的 `payload.level`（见 4 与 5.1）。
>
> **修订记录（rev.3，已吸收第二轮 review）**：进一步收敛 5 个实现细节：
> 1. **readPath 来源闭合**：`args.path` 是原始相对路径，须用 `resolveToolPath` 得到的**已解析绝对路径**；改为在 `beforeToolCall` 按 `toolCallId` 缓存（见 3.1）。
> 2. **triggered 用 `status: "info"`**，不用 `started`，避免 matched-only skill 永久显示「进行中」（见第 4 节）。
> 3. **`skillUsageState` 生命周期**：只在 run.finished/TTL 清理，**不能**随单条 fact 写 success 后 delete（见 5.1）。
> 4. **路径比较**：必须复用 `resolveToolPath`（含 skills 路径纠偏）+ 导出复用 `pathCompareKey`，否则漏记（见 5.2）。
> 5. 措辞修正：**「复用 fact 链路」但「改造 `recordSkillFact`」**，不是只加 emit（见 3.1）。
>
> **修订记录（rev.4，已吸收第三轮 review）**：补 5 个隐藏问题：
> 1. **evidence 不能存裸数组**：`sanitizePayload` 会把数组折叠成 `"[array:n]"`，改存 `payload.evidenceCsv`，测试直读 DB 验证（见第 4 节）。
> 2. **before 缓存不得改变工具行为**：`resolveToolPath` 空串会 throw，仅在 path 为非空字符串时尝试、包 try/catch、失败只是不记录（见 3.1）。
> 3. **`pendingReadPaths` 清理完整**：`after` 成功清、`error` 失败清、run finally 兜底清空（见 3.1 与第 7 节）。
> 4. **落地顺序去除旧说法**：(a) 已统一为「before 缓存 / after-error 消费」，不再写「after 补带 readPath」（见第 6 节）。
> 5. **信号→level/evidence 映射表**：显式 `skill.selected`（无 reason）缺省归 `explicit_invocation/triggered`，与 Phase 2 的 `search_match` 区分（见第 4 节）；并修正第 4 节表格被 blockquote 打断的排版。
>
> **修订记录（rev.5，已吸收第四轮 review）**：钉死运行顺序细节：
> 1. **缓存位置**：`beforeToolCall` 内 gate→preflight→budget→emit `tool.call.before` 的顺序下，缓存必须放在所有 deny/block **之后**，否则被拦截的 read 不走 after/error，会残留 pending key（见 3.1）。
> 2. **blocked 验收**：新增「read 被 gate/preflight/budget 拦截时不生成 loaded fact、不残留 pending key」的测试（见第 7 节）。

---

## 1. 背景与问题定义

### 1.1 现状：trace 已经为 Skill 留好了位置，但只覆盖一种场景

trace 体系里 Skill 相关的基础设施其实已经存在：

| 组件 | 位置 | 状态 |
|------|------|------|
| `skill_usage` fact 类型 | [traceStore.ts:9](../../src/lib/server/agent/hooks/traceStore.ts#L9) | ✅ 已定义 |
| `skill.selected` / `skill.loaded` hook stage | [types.ts:27-28](../../src/lib/server/agent/hooks/types.ts#L27-L28) | ✅ 已定义 |
| 把两个事件落成 `skill_usage` fact | [traceRecorderHook.ts:234-319](../../src/lib/server/agent/hooks/traceRecorderHook.ts#L234-L319) | ✅ 已实现 |
| 运行时日志同样消费这两个 stage | [runtimeLogHook.ts:131](../../src/lib/server/agent/hooks/runtimeLogHook.ts#L131) | ✅ 已实现 |

**但真正 emit 这两个事件的地方只有一处** —— [runner.ts:706-724](../../src/lib/server/agent/core/runner.ts#L706-L724)，且触发条件是 `findExplicitlyInvokedSkills`，即**只有显式调用语法**（`/skill-name`、`$skill-name`、`skill:skill-name`、`技能:skill-name`）才会被记录。

```ts
// runner.ts（节选）
const explicitlyInvokedSkills = findExplicitlyInvokedSkills(skills, enrichedText);
this.emitSkillSelection(explicitlyInvokedSkills);            // → skill.selected
// ...
for (const skill of explicitlyInvokedSkills) {
  this.hookManager.emit("skill.loaded", this.activeHookContext, {
    name: skill.name,
    scope: skill.scope,
    filePath: skill.filePath,
    reason: "explicit_invocation"
  });
}
```

### 1.2 缺口

| 场景 | 是否被追踪 |
|------|-----------|
| 用户/模型用显式语法点名某个 skill（`/x`、`$x`、`skill:x`） | ✅ 记录 `selected` + `loaded` |
| 模型按 prompt Step 1 路由**自己决定**去读 `SKILL.md` 并照做（隐式 / 语义触发） | ❌ **完全没记录** |
| 即便显式调用，是否真的**执行**了 skill 的步骤 | ❌ 无法区分 |

更进一步：当前 `skill.loaded` 的语义其实是「**我把 skill 文件内容注入进了 prompt**」，并不代表模型真的读懂并执行了那套步骤。

### 1.3 根本难点

**Skill 不是 tool，没有一个离散的「调用边界」。**

它本质是被注入到 prompt 的一段 markdown 指令，所谓「执行」就是模型读了那段文字、然后去调底层的 bash / 其他工具。因此：

- 「触发了」和「真执行了」之间没有硬信号；
- 隐式使用时，连「加载」都没有显式注入动作 —— 模型只是用 `read` 工具读了一个 `SKILL.md` 文件。

这也是这个追踪一直没实现的原因：它不像 tool / model call 那样有天然的 before/after 边界。

---

## 2. 设计原则：分级置信度（Tiered Confidence），而非单一布尔

不要把「用没用某 skill」做成一个布尔值。建议拆成三个**置信度递增**的层级，全部收敛到同一条 `skill_usage` fact（`fact_id = filePath`，天然去重 / 升级）：

| 层级 | 含义 | 信号来源 | 置信度 |
|------|------|---------|--------|
| **triggered / matched** | 这个 skill 被当成候选 | `skillSearch` 返回了它 / 显式语法命中 | 弱 |
| **loaded / opened** | skill 指令进入了工作上下文 | 显式注入（现状）**或** 模型 `read` 了该 skill 的 `SKILL.md` | 强 |
| **executed** | 有证据表明步骤被执行 | load 之后、同一 run 内，命中该 skill「特征命令」的 bash/tool 调用 | 启发式 |

> 设计要点：**executed 永远是启发式**，只能当「执行证据」，不能当「执行证明」。文档与 UI 上都应如实标注其置信度，避免误导（这与 prompt 里 [runner prompt 的 Runtime Integrity 条款](../../src/lib/server/agent/prompts/prompt.ts) 「不得声称用过未真正加载/调用的 skill」是一致的——准确追踪本身也支撑这条完整性约束的审计）。

---

## 3. 分阶段实现方案

### Phase 1（便宜、收益最大）：用「读 SKILL.md」补隐式加载

**这是目前最大的窟窿，且信号现成。**

#### 信号

模型按 Step 1 路由决定使用某 skill 时，prompt 要求它「read that skill's SKILL.md and follow it」。这一步是通过 `read` 工具（或 bash `cat`）读取一个 `*/SKILL.md`（或 `skill.md`）路径完成的。这是隐式使用场景下**最强的「skill 进入工作上下文」信号**。

- `read` 工具入参就是 `path`（[read.ts:42](../../src/lib/server/agent/tools/read.ts#L42)）。
- skill 列表在 runner 的 run 方法里本来就 load 好了（`loadSkillsFromWorkspace`，[runner.ts:702](../../src/lib/server/agent/core/runner.ts#L702)），每个 skill 都有 `filePath`。

#### ⚠️ 关键约束：`tool.call.after` 当前拿不到工具参数

> 这是 review 指出、且经源码核对属实的硬约束，方案必须围绕它设计。

当前 runner 只在 **`tool.call.before`** 的 payload 里带 `argsPreview`（[runner.ts:280](../../src/lib/server/agent/core/runner.ts#L280)）。**`tool.call.after` / `tool.call.error` 的 payload 只有** `toolName / toolCallId / displayName / isError / resultPreview`，**没有任何 args**（[runner.ts:291-301](../../src/lib/server/agent/core/runner.ts#L291-L301)）。

因此「在 after 里解析 `args.path`」是行不通的。**注意两层问题**：① after 当前压根不带 args；② 即便带了，`args.path` 是用户给的**原始相对路径**，真正用于比对的「已解析绝对路径」是在 read 工具内部用 `resolveToolPath(ctx.cwd, path)` 算出来的（含特殊纠偏，见 5.2）。所以必须拿到**已解析路径**，而不是原始 `args.path`。两条可行路径：

- **(a)（推荐）在 `beforeToolCall` 缓存已解析路径**：`beforeToolCall` 已经在用 `context.args`（[runner.ts:280](../../src/lib/server/agent/core/runner.ts#L280)）。当 `toolName === "read"` 时，用与工具一致的 cwd/workspaceDir 调 `resolveToolPath` 得到绝对路径，按 `toolCallId` 存入一个临时 `Map`；到 `after`/`error` 时取出归因并清理该 key。优点：不改 `read` 工具的 result/details 输出语义。
- **(b) 让 `read` 工具在 result/details 里带回 `resolvedPath`**：消费方直接从 `context.result.details` 读。缺点：改动了工具输出语义，且要确保所有调用方都接受新增字段。

本方案推荐 **(a)**。无论哪种，after 阶段拿到的都必须是**已解析绝对路径**。

#### 改动点（修订后）

落点选 **runner 内**（理由见下「待定决策」）。三步：

1. **beforeToolCall 缓存已解析路径**：在 [runner.ts:280 的 `beforeToolCall`](../../src/lib/server/agent/core/runner.ts#L280) 里，当 `toolName === "read"` 时算出绝对路径，按 `toolCallId` 存入实例上的 `this.pendingReadPaths: Map<toolCallId, absPath>`。
2. **afterToolCall / error 取出、匹配并 emit**（见伪代码）。
3. **TraceRecorderHook 侧合并 level/evidence**（见 5.1）。

```text
# beforeToolCall（仅缓存，绝不影响工具执行）
# ⚠️ 位置：必须放在所有 deny/block 判断【之后】、紧贴现有 tool.call.before emit 之前（见下「缓存位置」）
当 toolName === "read"（且已通过 gate / preflight / budget，即工具确定会执行）：
  path = context.args?.path
  if (typeof path === "string" && path.trim()):       # resolveToolPath 空串会 throw（path.ts:26）
    try:
      abs = resolveToolPath(cwd, path)                 # 与 read 工具同 cwd/workspaceDir
      this.pendingReadPaths.set(toolCallId, abs)
    catch:
      # 解析失败：只是不记录 skill usage，不抛出、不影响工具/preflight/budget 流程

# afterToolCall 与 error 都要消费并清理
当 tool.call.after 或 tool.call.error 且 toolName === "read"：
  resolvedPath = this.pendingReadPaths.get(toolCallId)
  this.pendingReadPaths.delete(toolCallId)             # 成功/失败都 delete，防泄漏
  if (resolvedPath 且 非 error):                        # read 失败不算 loaded
    matched = 本 run skill manifest 中 pathCompareKey(filePath) === pathCompareKey(resolvedPath) 的项（见 5.2）
    若 matched：
      emit("skill.loaded", ctx, { name, scope, filePath, reason: "read_skill_file" })

# run 结束兜底
run finally: this.pendingReadPaths.clear()
```

> ⚠️ **缓存位置必须钉死在「block 判断之后」（review 指出，已核对属实）**。`beforeToolCall` 内部顺序是：`hookManager.gate("tool.call.before")` → deny 则 emit `tool.call.blocked` 并 `return block`；再 `validateToolCallPreflight` + budget → blocked 则 emit `tool.call.blocked` 并 `return block`；**最后**才 emit `tool.call.before`（[runner.ts:231-284](../../src/lib/server/agent/core/runner.ts#L231-L284)）。
>
> 被 block 的工具**不会**走到 `afterToolCall` / `tool.call.error`。因此若把 `pendingReadPaths.set` 放在 gate/preflight/budget **之前**，一个被拦截的 `read` 会留下一个永远不被消费的 pending key —— 虽然 run finally 会兜底，但长 run 内会持续累积。
>
> 两种正确写法：① **缓存放在所有 deny/block 之后、紧贴现有 `tool.call.before` emit 之前**（推荐，最简单：只有确定会执行的 read 才入缓存）；② 若因结构原因必须早缓存，则**每个 `tool.call.blocked` 分支也要按 `toolCallId` delete**。本方案采用 ①。

- 复用现有 `skill_usage` fact 类型与 upsert 链路，**无需改表**；但 **`recordSkillFact` 需要改造**（不是只加 emit —— 必须做 level 单调升级 + evidence 合并，见 5.1）。
- 用 payload 里的 `reason` 区分「显式注入（explicit_invocation）」还是「读文件（read_skill_file）」；用 `payload.level` 表达置信度（见第 4 节）。

> ⚠️ **追踪逻辑绝不能改变工具行为（review 指出）**。`beforeToolCall` 里解析路径只为缓存，必须：① 仅在 `typeof path === "string" && path.trim()` 时尝试（`resolveToolPath` 对空串会 throw，[path.ts:26](../../src/lib/server/agent/tools/path.ts#L26)）；② 整段包 try/catch；③ 失败时只是「不记录 skill usage」，**不得**把异常冒泡成 runner 层错误、也不得干扰原有的 `blocked` / preflight / budget / error 流程。

#### ⚠️ 即便放 runner 内，skill manifest 也不在 `afterToolCall` 作用域里

skill 列表是 run 方法里的局部 `const skills`（[runner.ts:702](../../src/lib/server/agent/core/runner.ts#L702)），而 `afterToolCall` 闭包定义在另一处（[runner.ts:285](../../src/lib/server/agent/core/runner.ts#L285)），两者作用域不通。

因此需要把本 run 的 skill manifest **挂到实例上**，仿照现有的 `this.activeHookContext` 模式，例如新增 `this.activeRunSkillManifest: Map<filePath, LoadedSkill>`，在 run 开始 load skill 后写入、run 结束清理。路径上下文（`getScratchDir` / `getWorkspaceDir`）runner 本来就有，无需额外引入。

#### 待定决策（需 review 拍板）

1. **匹配逻辑放哪？**
   - **方案 A（推荐，先做这个）**：放在 runner 内（`afterToolCall` + 实例上的 skill manifest）。优点：skill 列表与路径上下文都在手边，能最快上线、信号最稳。缺点：runner 已经很重，且需新增一个实例字段。
   - 方案 B：抽一个独立的 observe-only hook（如 `SkillUsageHook`）订阅 `tool.call.*`。**当前不可行**：`HookContext` 只有一组 ID（[types.ts:42-52](../../src/lib/server/agent/hooks/types.ts#L42-L52)），**没有 `workspaceDir`/`cwd`**，`run.started` payload 也不带 skill 列表（[runner.ts:916-922](../../src/lib/server/agent/core/runner.ts#L916-L922)）；独立 hook 既无法把 `read.path` resolve 成绝对路径、也拿不到 skill `filePath` 集合，无法做精确比较。
   - **结论**：先按方案 A 在 runner 内落地，信号稳定后，若要解耦再考虑 B —— 但 B 的前提是先给 `run.started` 增加 `skillManifest` 并给 hook 注入 workspace resolver（`cwd`/`workspaceDir`）。这是一个独立的前置改造，不应和 Phase 1 捆绑。
2. **bash `cat`/`head` 读 skill 要不要也算？** 建议**第一版先不做**，只认 `read` 工具（信号干净、零歧义）。bash 读取需要解析命令行 token，误报面大，留到 Phase 1 稳定后再评估。

---

### Phase 2：用 `skillSearch` 补「triggered」

#### 信号

`skillSearch` 工具的返回结构里已经带了 `details.matches`，每项含 `name / filePath / scope / score / reasons`（[skillSearch.ts:382](../../src/lib/server/agent/tools/skillSearch.ts#L382)）。对每个 match emit 一个**低置信度**的 `skill.selected`（`reason: "search_match"`）。

#### ⚠️ skillSearch 工具本身没有 emit 能力

`createMomTools` 的 options 里**没有** hook manager / emit 入口，只有 `emitRunnerEvent?`（[index.ts:119](../../src/lib/server/agent/tools/index.ts#L119)）；工具内部当前只写 `momLog`。所以「让 skillSearch 自己 emit」缺接线。两种修法：

- **(a) 给工具层注入受限回调**：在 `createMomTools` options 增加一个窄接口（如 `onSkillSearchMatches?(matches)`），由 runner 绑定到 `hookManager.emit`。
- **(b)（推荐）在 runner `afterToolCall` 里统一处理**：`afterToolCall` 的 `context.result` 拿得到（[runner.ts:286-299](../../src/lib/server/agent/core/runner.ts#L286-L299) 已在用 `context.result`）。当 `toolName === "skillSearch"` 时，读 `context.result.details.matches`，对每项 emit `skill.selected`。

推荐 **(b)**：和 Phase 1 的归因逻辑落在同一处（runner `afterToolCall`），无需改工具签名，证据来源集中、好维护。

#### 价值

能回答「哪些 skill 被检索 / 浮现过，但最终没被用」—— 对评估 skill 描述（description）触发准确率、优化路由很有用。

#### 注意

- 这层很**嘈杂**（一次搜索可能返回多个候选，实际只用其一甚至都不用）。
- UI / 查询上必须能把「matched-only」与「真 loaded / executed」区分开。靠 `payload.level` + status 区分（见第 4 节）。
- 与 Phase 1 的「状态单调性」强相关：`search_match` 是最低层级，绝不能覆盖已经 `loaded`/`executed` 的 fact（见 5.1）。

---

### Phase 3（难、可选）：执行归因（executed）

#### 信号

给 `SKILL.md` 的 frontmatter 增加**可选**元数据，声明该 skill 驱动的特征信号，例如：

```yaml
---
name: longbridge
description: ...
signals:
  cli: ["longbridge", "lb "]      # bash 命令前缀
  mcp: ["longbridge"]              # mcp server id
  tools: ["webSearch"]            # 工具名
---
```

load 之后，把同一 run 内、load 时间点之后、命中这些 signal 的 bash/tool 调用归因到该 skill，把该 skill fact 升级到 `executed`（或在 payload.evidence 里追加 `cli_signal`）。

#### 注意

- 纯启发式：一个 bash `longbridge ...` 命中不代表一定是该 skill 触发的（用户也可能直接让模型跑命令）。
- 多个 skill signal 重叠时归因有歧义，需定义优先级（如「最近一次 loaded 的 skill 优先」）。
- 建议作为「执行证据」呈现，并标注置信度，**不要**当成确定性的执行记录。

---

## 4. 数据模型：零迁移表达三层置信度

`skill_usage` fact 已经以 `(fact_type, run_id, fact_id)` 为唯一键（[traceStore.ts:158](../../src/lib/server/agent/hooks/traceStore.ts#L158)），`fact_id` 用 `filePath`。这意味着**同一 run 内对同一 skill 的多个信号会自动收敛成一条 fact 并升级状态**，无需新表。

建议的字段语义映射（**无需 schema 迁移**）：

| 概念 | 落到哪 | 说明 |
|------|--------|------|
| **稳定的置信度层级** | `payload.level`：枚举 `"triggered" \| "loaded" \| "executed"` | **这是判断单调性的唯一权威字段** |
| 粗粒度状态（兼容现有 UI/查询） | `status`：`triggered → "info"`；`loaded / executed → "success"` | 由 `level` 派生，不单独维护 |
| 证据链 | `payload.evidenceCsv`：逗号分隔字符串，如 `"search_match,read_skill_file"` | 累积追加去重，**不要用裸数组**（见下） |
| skill 名 / scope / 路径 | 现有 `name` / `payload.scope` / `fact_id` | |

> ⚠️ **triggered 不要用 `status: "started"`**（review 指出）。`started` 在现有 UI / 统计里语义是「进行中」。`skillSearch` 命中但最终没被加载的 skill（matched-only）若用 `started`，run 结束后会永远显示为「进行中」，污染 trace 视图和统计。弱信号用 `status: "info"`（trace 体系里 `info` 已是合法状态，见 [traceStore.ts:42](../../src/lib/server/agent/hooks/traceStore.ts#L42)），既表达「发生过」又不被当成未完成。`loaded`/`executed` 才用 `success`。

> ⚠️ **证据链不能存裸数组（review 指出，已核对属实）**。`TraceRecorderHook.sanitizePayload()` 会把 payload 里**任何数组折叠成 `"[array:n]"`**（[traceRecorderHook.ts:28-29](../../src/lib/server/agent/hooks/traceRecorderHook.ts#L28-L29)）。也就是说即便 `skillUsageState` 内部把 evidence 合并成数组，落到 DB 的 `payload_json.evidence` 也会变成 `"[array:2]"`，统计 / 断言全部失效。
>
> 修法二选一：① **存成不会被折叠的标量**，如 `payload.evidenceCsv`（逗号分隔字符串，本方案采用）；② 给 `sanitizePayload` 开一个白名单，让 `evidence` 这类「短字符串数组」穿过。倾向 ①，零侵入、不放宽 sanitizer 的通用约束。**测试必须直接读 DB fact 的 payload，验证 evidence 的真实落库形态**，而不是只验内存态。

> ⚠️ **不要用 `payload.reason` 表达层级**。`reason` 是单值，会被**最后一次**信号覆盖（`payload_json` 整体覆盖写入），无法表达「本 run 已达到的最高层级」。层级判断必须依赖独立的 `payload.level`，`reason` 只作为「最近一次触发原因」的辅助信息。

层级序：`triggered (1) < loaded (2) < executed (3)`。任何新信号只能把 `level` **向上**抬，不能向下压（见 5.1）。

#### 信号 → level / evidence 映射（供 `recordSkillFact` 实现，避免命名发散）

| hook 事件 | payload.reason | evidence token | level |
|-----------|----------------|----------------|-------|
| `skill.selected`（现有显式调用，无 reason 字段） | 缺省视为 `explicit_invocation` | `explicit_invocation` | `triggered` |
| `skill.selected`（Phase 2，来自 skillSearch） | `search_match` | `search_match` | `triggered` |
| `skill.loaded`（现有显式注入） | `explicit_invocation` | `explicit_invocation` | `loaded` |
| `skill.loaded`（Phase 1，读 SKILL.md） | `read_skill_file` | `read_skill_file` | `loaded` |
| （Phase 3，特征命令命中） | `cli_signal` | `cli_signal` | `executed` |

> 关键：现有显式 `skill.selected` 的 payload **没有 `reason` 字段**（[runner.ts:2089-2094](../../src/lib/server/agent/core/runner.ts#L2089-L2094) 只带 name/scope/filePath/aliases），`recordSkillFact` 必须对「无 reason 的 selected」缺省归为 `explicit_invocation`，否则与 Phase 2 的 `search_match` 混淆、evidence 命名会散。

> 关于「是否要独立 schema 列」：短期 `payload.level` 零迁移即可。但**若未来要按层级做聚合统计 / 排序**（如「列出本周所有 executed 的 skill」），`payload_json` 里取字段做 SQL 过滤会很别扭。届时建议把 `level` 提升为 `agent_trace_facts` 的一个真实列（带索引），作为 Phase 2 之后的独立优化项，不阻塞 Phase 1。

---

## 5. 必须注意的坑

### 5.1 状态不能降级（monotonic upgrade）

`upsertFact` 里 `status = excluded.status` 与 `payload_json = excluded.payload_json` 都是**无条件覆盖**（[traceStore.ts:219](../../src/lib/server/agent/hooks/traceStore.ts#L219)、[traceStore.ts:232](../../src/lib/server/agent/hooks/traceStore.ts#L232)）。

> 风险场景：先记了 `loaded`，后来又来一个 `search_match`，若直接 upsert 会把 `level` 打回 `triggered`、并把已累积的 `evidence` 覆盖丢失。

#### ⚠️ 「写入前读旧值合并」目前不是现成能力（review 指出，已核对属实）

要实现「单调升级 + evidence 累积」，需要在写入前拿到该 skill fact 的**当前 level 和 evidence**。但：

- `TraceRecorderHook` 的内存 state `FactStartState` 只存 `{ id, startedAt }`（[traceRecorderHook.ts:37-40](../../src/lib/server/agent/hooks/traceRecorderHook.ts#L37-L40)），**不含 status / level / payload**。
- `SqliteTraceStore` 只有 `listByRunId` / `listBySessionId` / `listRecentFacts`，**没有按 `(factType, runId, factId)` 读单条 fact 的 API**（[traceStore.ts:300-321](../../src/lib/server/agent/hooks/traceStore.ts#L300-L321)）。

所以这不是「写入前先读一下」那么轻，需要新增能力，二选一：

- **A（推荐，内存态）**：在 `TraceRecorderHook` 内为 skill_usage 维护一个专门的 `skillUsageState: Map<factKey, { level, evidenceSet: Set<string> }>`，与现有 `facts` 并列。每次 record 前从内存读当前 level/evidence，算出新 level（取 max）、把新 token 加入 set，再 upsert（写库时把 set 序列化成 `evidenceCsv`，见第 4 节）。优点：不碰 DB、无并发读放大；缺点：进程重启丢失中间态（但同一 run 内通常不跨重启，可接受）。
- **B（持久态）**：给 `SqliteTraceStore` 新增 `getFactByKey(factType, runId, factId): TraceFactRecord | null`，record 前读 DB 合并。优点：跨重启稳健；缺点：每次 skill 信号多一次 DB 读。

> 推荐 A：skill 信号在单个 run 内频率不高，内存态足够，且与现有 `runState` 的生命周期管理（run.finished 清理、TTL sweep）天然一致。
>
> 无论 A/B，`recordSkillFact` 都要改造：先合并 level/evidence，再把合并结果写进 payload，最后由 `level` 派生 `status`。当前的 `recordSkillFact`（[traceRecorderHook.ts:310-319](../../src/lib/server/agent/hooks/traceRecorderHook.ts#L310-L319)）只是直接转发，需要重写。

> ⚠️ **`skillUsageState` 的清理时机必须区别于通用 `facts`**（review 指出）。现有通用 `recordGenericFact` 在状态变为非 started 时会 `facts.delete(key)`（[traceRecorderHook.ts:347-351](../../src/lib/server/agent/hooks/traceRecorderHook.ts#L347-L351)）—— 因为它假设「success/error 即终态」。但 skill 不是：一个 skill 先 `loaded(success)` 之后，同一 run 内可能再来 `search_match`，仍需读到之前的 level/evidence 才能正确合并（而不是被低层级信号覆盖）。
>
> 因此 `skillUsageState` **只能在 `run.finished` 或 TTL sweep 时整体清理**，绝不能在单条 skill fact 写成 `success` 后就 delete 该 key。这是它和 `facts` 在生命周期上的关键区别，实现时不要照搬 `facts` 的 delete-on-success 模式。

### 5.2 路径比较规则（避免漏记）

> review 指出：单写「绝对路径归一化后精确等于」**不够可实现**，会漏记而非误报。原因如下，必须复用现有解析逻辑。

`read` 工具内部用 `resolveToolPath(ctx.cwd, path)`（[path.ts:25](../../src/lib/server/agent/tools/path.ts#L25)），它**不是简单的 `resolve()`**，含两处特殊纠偏：

- `data/moli-*/skills/...`（或 `telegram-mom`）→ 真实的 `<dataRoot>/skills/...`（[path.ts:44-48](../../src/lib/server/agent/tools/path.ts#L44-L48)）；
- `data/moli-*/<chatId>/skills/...` → 真实的 `<workspace>/<chatId>/skills/...`（[path.ts:56-60](../../src/lib/server/agent/tools/path.ts#L56-L60)）。

而 skill manifest 里的 `filePath` 是 `loadSkillsFromWorkspace` 扫出来的**真实绝对路径**。若不复用同一 resolver，模型用 `data/moli-x/skills/...` 形式读文件时，原始路径与 manifest 路径对不上 → **漏记**。

实现要求：

1. before 缓存时**复用 `resolveToolPath`**（同一 cwd/workspaceDir），得到与工具一致的绝对路径。
2. 比较时用一个 **compare helper** 吸收大小写（macOS/Windows 不敏感）、`resolve()`、必要时 `realpath`（软链）。代码库已有 `pathCompareKey`（[path.ts:17-23](../../src/lib/server/agent/tools/path.ts#L17-L23)，含 darwin/win32 的 `toLowerCase`），但**当前未 export** —— 实现时应导出复用，不要另写一份比较逻辑。
3. 匹配仍是**精确相等**（compare key 相等），不做模糊 `includes`，避免误报。

### 5.3 Phase 3 误报控制

- signal 匹配要保守，宁可漏报不可乱归因。

---

## 6. 推荐落地顺序

1. **先做 Phase 1（runner 内）**：用一个已经在流动的信号（read SKILL.md）堵住最大窟窿（隐式使用）。四个改动点：
   - (a) `beforeToolCall` 缓存 resolved read path（`this.pendingReadPaths`，含空串/异常防护），`after`/`error` 消费并清理，run finally 兜底清空；
   - (b) runner 把本 run skill manifest 挂实例（`this.activeRunSkillManifest`）；
   - (c) `TraceRecorderHook` 引入 `skillUsageState`（run.finished/TTL 才清）+ `level`/`evidenceCsv` 合并，重写 `recordSkillFact`；
   - (d) 导出复用 `pathCompareKey` 做路径比较。
   复用现有 `skill_usage` fact 链路，无需改表。
2. **Phase 2**：在同一处（runner `afterToolCall`）读 `skillSearch` 的 `details.matches`，emit `search_match`。视「候选 vs 真用」统计需求决定是否做。
3. **可选优化**：把 `level` 提升为 `agent_trace_facts` 真实列（带索引），便于按层级聚合查询。
4. **Phase 3**：视是否需要「执行证据」粒度决定，且需要给 skill 作者增加 frontmatter `signals` 约定。

---

## 7. 验收 / 测试建议

- **before/after 路径配对**：断言 `read` 调用经 before 缓存、after 取出后能拿到**已解析绝对路径**，且取出后 `pendingReadPaths` 里该 key 被清理（这是新增能力，必须先有测试守住）。
- **清理无泄漏**：① `read` **失败走 `tool.call.error`** 时同样 delete 该 key、且不生成 `loaded` fact；② run 结束后 `pendingReadPaths` 整体被清空（防长 run 泄漏）。
- **blocked 不残留**：`read` 被 **hook gate / preflight / budget 拦截**（走 `tool.call.blocked`、不经 after/error）时，不生成 `loaded` fact，且 `pendingReadPaths` 不留残键 —— 这正是「缓存放在 block 判断之后」的回归守卫。
- **追踪不改工具行为**：传入空串 / 非法 path 时，before 缓存逻辑不抛出、不影响工具原有的执行 / blocked / error 流程。
- **Phase 1 命中**：构造隐式场景（`read` 某 `SKILL.md`），断言生成一条 `skill_usage` fact，`payload.level === "loaded"`、`payload.reason === "read_skill_file"`；并断言**显式注入（explicit_invocation）**与**读文件（read_skill_file）**两种来源能区分。
- **状态单调性 + evidence 累积（直读 DB）**：按 `search_match → read_skill_file → （后到的）search_match` 顺序 emit，**直接查 DB fact 的 `payload_json`** 断言：① 最终 `level === "loaded"` 不被后到的低层级信号压回 `triggered`；② `status` 保持 `success` 不退回 `info`；③ `payload.evidenceCsv === "search_match,read_skill_file"`（去重、不丢、**不是 `"[array:n]"`**）。
- **triggered-only 不卡进行中**：只 emit `search_match`、不 emit `loaded`，run 结束后断言该 fact `status === "info"`（不是 `started`），不会在 UI/统计里显示为「进行中」。
- **路径纠偏命中**：用 `data/moli-x/skills/foo/SKILL.md` 形式的原始路径读一个真实位于 `<dataRoot>/skills/foo/SKILL.md` 的 skill，断言经 `resolveToolPath` 纠偏后仍能命中 manifest（防漏记）。
- **误报**：read 一个非 skill 文件、read 一个名字相近但路径不同的文件，断言**不**生成 skill fact。
- **路径边界**：相对路径、绝对路径、大小写差异（macOS/Windows），都要么精确命中要么明确不命中，无误报。
- 复用现有 `traceRecorderHook.test.ts` 的模式扩展用例。

---

## 8. 开放问题（留给 review）

1. 已解析路径来源，选 **(a) `beforeToolCall` 按 toolCallId 缓存** 还是 **(b) `read` 工具 result/details 带回 `resolvedPath`**？本方案倾向 (a)（不改工具输出语义）。
2. level/evidence 合并态选 **A 内存（`skillUsageState`，run.finished/TTL 清理）** 还是 **B 持久（`getFactByKey`）**？本方案倾向 A。
3. `level` 短期放 `payload` 即可；是否、以及何时提升为独立 DB 列做聚合查询？
4. `executed`（Phase 3）这层是否值得做？还是 `loaded` 已满足「哪些 skill 触发了 / 加载了」的核心诉求？
5. 是否需要在前端 trace 视图里把三层置信度可视化（如不同颜色 / 标签）？`info`（triggered）/`success`（loaded/executed）的视觉区分怎么定？
