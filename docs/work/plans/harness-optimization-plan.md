# Harness 优化方案 v3：先补委派能力，再验证质量闭环

> 状态：提案，未排期  
> 来源：Anthropic《Harness design for long-running agents》对照分析  
> 关联：`docs/research/sandbox/subagent-sandbox.md`

## 1. 先说结论

Molibot 暂时不需要建设一套完整的多 Agent 开发平台。

现有 Runner 已经有预算、锁、上下文压缩、Subagent、Trace 和审批。当前最值得解决的是两个具体问题：

1. Subagent 偏向代码任务，不能承担搜索、资料整理等办公工作。
2. 复杂任务完成后，缺少独立验证，主 Agent 容易把“已经写完”当成“已经可用”。

因此按下面的顺序推进：

```text
办公 Subagent
    ↓ 先验证委派是否有收益
独立验证
    ↓ 再验证质量是否提高
修复循环
    ↓ 确认长任务确实需要
checkpoint / 恢复 / UI QA
```

不要一开始同时实现动态角色系统、完整状态机、浏览器 QA、自动恢复和质量 Dashboard。它们每一项都不小，绑在一起会让方案长期无法交付。

## 2. 哪些现状需要改

当前有四个明确缺口：

- Subagent 角色和工具面写死在 `subagent.ts`，新增办公角色需要改运行时代码。
- Subagent 只能使用文件和 Shell 工具，不能执行 `webSearch`。
- `reviewer` 只能静态读代码，不能运行测试，因此不是独立 QA。
- 每个 Subagent 使用独立预算。并行委派会放大模型和远程工具成本。

下面这些不是第一阶段问题：

- 通用自定义角色市场。
- 任意 Workspace 安装角色。
- 模型上下文完整恢复。
- 自动启动任意项目并用浏览器验收。
- 自动判断所有任务该使用几名 Agent。

## 3. 第一阶段：让 Subagent 适合办公任务

### 3.1 用能力配置替代按角色名写分支

保留现有内置角色注册表，不做动态目录扫描。先把角色定义改成明确的能力配置：

```ts
interface SubagentProfile {
  // qa 在第二阶段加入,走同一 profile 机制
  name: "scout" | "planner" | "worker" | "reviewer" | "researcher" | "doc-analyst" | "qa";
  files: "none" | "read" | "readwrite";
  shell: "none" | "readonly" | "full";
  webSearch: boolean;
}
```

运行时根据 profile 注入工具。不要再通过 `agent.name === "worker"` 判断权限。

这样已经能解决当前问题，而且比“扫描任意 Markdown 自动注册角色”更容易验证。以后确实出现用户自定义角色需求，再把注册表外置。

以下工具继续只属于父 Agent：

- 消息发送和附件发送
- 图片、视频、语音生成
- 发布、发帖、定时任务
- 模型和系统配置修改

这些操作有外部副作用或明显成本，不进入 Subagent。

### 3.2 新增 researcher

`researcher` 用于需要多轮搜索的任务，例如选题调研、竞品追踪和资料搜集。

能力：

```text
files: read
shell: readonly
webSearch: true
```

输出至少包含：

- 结论和对应来源 URL
- 未确认或互相冲突的信息
- 一段可以直接交给父 Agent 的简短摘要

第一版不做复杂 PII 检测。只做必要保护：

- 限制搜索次数和查询长度。
- 搜索调用计入父 Run 的远程工具预算。
- 不允许把大段本地文件原文直接作为搜索词。这条在 webSearch 工具层强制(长度/相似度阈值),prompt 里的约束只是补充。
- Trace 只记录截断、脱敏后的 query preview。

### 3.3 新增 doc-analyst

`doc-analyst` 负责扫描文件并输出结构化清单。它只读，不负责移动、删除或改写文件。

能力：

```text
files: read
shell: readonly
webSearch: false
```

实际文件操作继续交给父 Agent 或 worker。这样分析和修改是分开的，出错范围更小。

### 3.4 worker 改成领域中立

保留一个 worker，不再增加 generalist。

worker 接收“具体任务 + 交付标准”，可以处理代码，也可以整理文件、生成报告。Prompt 不再默认任务一定是改代码。

### 3.5 共享预算只先解决实际问题

不新增一套完整 `HarnessBudget`。在现有父 RunBudget 上增加两个聚合计数即可：

- `subagentRuns`
- `remoteToolCalls`

每个 Subagent 仍保留自己的工具调用和超时限制。父 Run 只负责限制一轮任务总共能启动多少子任务、发起多少远程调用。

### 第一阶段验收

- 现有角色行为不变。
- researcher 能完成一次真实调研，并返回可核对的 URL。
- doc-analyst 能扫描混合文件夹并输出清单，但不能修改文件。
- 三个并行 researcher 共享同一个远程调用上限。
- 父 Agent 的工具调用数和上下文占用比未委派时下降。

## 4. 第二阶段：先做“可执行验证”，不要急着做完整 QA

Anthropic 方案真正有价值的部分，是实现者和验证者分开。Molibot 可以先实现一个较小版本。

### 4.1 简化 TaskContract

只有中高复杂度的项目任务才生成合同。普通问答和轻量文件操作不进入这套流程。

由谁决定、由谁生成:

- 是否进入合同流程,由父 Agent 在回合内自行判断(它是 LLM,不需要额外的 preflight 机制;参考信号:是否多文件修改、是否要求实施、是否有可验证的交付物)。
- 合同由父 Agent 直接生成,或委派 planner 生成后由父 Agent 确认;两种情况都必须通过 schema 校验才算定稿。

```ts
interface TaskContract {
  goal: string;
  criteria: Array<{
    id: string;
    behavior: string;
    verification: VerificationSpec;
  }>;
}
```

第一版不加入 `riskProfile`、revision、scope、exclusions 等字段。实际使用证明需要后再补。

`VerificationSpec` 必须是结构化数据，不能让 Planner 生成一段 Shell 字符串交给运行时执行：

```ts
type VerificationSpec =
  | { kind: "command"; executable: string; args: string[]; cwd: "project"; timeoutMs: number }
  | { kind: "manual"; instructions: string };
```

Runtime 需要校验 executable、参数、工作目录和超时。验证不得读写真实用户数据库。

executable 白名单第一版用内置短清单(如 `npm`、`pnpm`、`npx`、`node`、`vitest`、`tsc`),项目配置可追加;不在清单内的命令直接拒绝,不做模糊匹配。

### 4.2 中等任务：worker + deterministic verifier

中等任务不启动 LLM QA：

```text
TaskContract
    ↓
worker 实现
    ↓
Runtime 执行合同里的验证
    ↓
通过 / 失败 / 需要人工检查
```

验证结果由 Runtime 判定，不能由 worker 自己宣布通过。

这一阶段 `HarnessController` 还不存在，verifier 的形态是一个父 Agent 可调用的工具：输入 `VerificationSpec`，输出逐条 `passed | failed` 加原始输出。判定逻辑在工具代码内部计算，父 Agent 只能引用结论，不能改写它；每次验证结果同时写入 Trace。这个工具就是第三阶段 `HarnessController` 的胚胎。

这一步先回答一个问题：结构化验收能否减少“代码写了但没真正验证”的情况。Trace 里的验证记录从这一阶段就开始积累，作为后续 M4 是否值得做的证据。

### 4.3 高复杂度任务：增加 qa，但第一版只检查现有验证

新增 `qa` 角色，但不要立即赋予浏览器和服务管理能力。第一版 QA 只做：

- 检查 TaskContract 是否覆盖用户要求。
- 检查 verifier 的真实输出。
- 读取改动和失败信息。
- 对每条 criterion 返回 `passed | failed | blocked` 和证据。

QA 只返回结构化结果。它不能修改代码，不能直接写状态，也不能自行把任务标记为完成。

共享 Agent 层增加一个轻量 `HarnessController`，负责：

- 调用 worker、verifier 和 QA。
- 校验各阶段返回值。
- 决定任务是否通过。
- 把阶段和结果写入 Trace。

不要把这些逻辑放进 Channel，也不要让 Agent 自己维护权威状态。

### 第二阶段验收

- Planner 生成的恶意命令不能绕过 verifier 白名单。
- worker 声称成功但测试失败时，最终结果必须是 failed。
- QA 没有证据时不能给出 passed。
- 每条 criterion 都能关联到实际验证输出。
- 普通任务不增加额外 Planner/QA 成本。

## 5. 第三阶段：验证闭环有效后，再增加修复和恢复

只有第二阶段的数据证明独立验证能稳定发现问题，才继续做这一阶段。

### 5.1 先加有限修复循环

```text
implementing → verifying → repairing → verifying → done
                                  ↘ blocked
```

- 默认最多修复两轮。
- 只修复、重验失败的 criterion。
- 超过上限转 blocked，交给用户决定。
- stop 终止当前阶段并保留进度，不自动取消整个任务。

### 5.2 再加最小 checkpoint

不要保存 Agent session，也不要一开始设计多文件 checkpoint 协议。第一版保存一个由共享上层写入的结构化 checkpoint：

```ts
interface HarnessCheckpoint {
  runId: string;
  phase: "implementing" | "verifying" | "repairing" | "done" | "blocked";
  attempt: number;
  contract: TaskContract;
  implementation?: unknown;
  evaluation?: unknown;
  updatedAt: string;
}
```

恢复时启动新 Agent，并读取 checkpoint。Agent 只能返回阶段结果，只有 `HarnessController` 可以更新 checkpoint。

恢复不直接复用 Automation 的入站任务机制。Automation 最多发送 `resume_requested` 事件，由共享上层通过 CAS claim 确保同一 Run 只有一个恢复者。

### 第三阶段验收

- 进程在实现或验证后退出，重启后不会重复已完成阶段。
- 两个恢复请求竞争时，只有一个获得执行权。
- stop 后 checkpoint 状态明确，服务和子任务都已停止。
- 两轮修复仍失败时任务进入 blocked，不再消耗预算。

## 6. 浏览器 QA 和 Context Reset 都后置

浏览器 QA 需要端口分配、服务进程管理、Playwright、截图、超时回收和审批。这是一个独立项目，不应伪装成“增加一个 qa.md”。

只有以下条件都满足时再建设：

- 文本/命令 verifier 已稳定运行。
- UI 任务占复杂任务的比例足够高。
- 人工检查确实是主要瓶颈。
- 可以保证 dev server 和浏览器进程被可靠回收。

Context reset 也不默认实现。先看 Trace 是否反复出现合同遗漏、重复实现或 compaction 后提前收尾。没有证据就继续使用现有 compaction。

## 7. 实施顺序

| 阶段 | 内容 | 是否现在做 |
|------|------|------------|
| M1 | 角色能力配置、researcher、doc-analyst、worker 中立化、聚合远程调用限制 | 是 |
| M2 | 简化 TaskContract、受控 command verifier | 是 |
| M3 | 轻量 HarnessController、只读 QA、单轮验证 | M2 稳定后 |
| M4 | 两轮修复、最小 checkpoint、幂等恢复 | 有质量收益数据后 |
| M5 | 浏览器 QA、服务生命周期管理 | 有明确 UI 验收需求后 |
| M6 | Context reset、完整质量 Dashboard、自定义角色目录 | 有 Trace 证据后 |

## 8. 暂时不做

- 不自动扫描任意 Markdown 注册角色。
- 不建设角色市场或 Workspace 角色权限系统。
- 不把所有任务强制拆成 Planner、Worker、QA。
- 不允许 Planner 生成任意 Shell 给 QA 执行。
- 不把 Harness 恢复当成重新提交一次用户消息。
- 不把状态机、恢复、审批和队列逻辑放进 Channel。
- 不在第一版实现浏览器 QA。
- 不在第一版实现完整质量 Dashboard。
- 不做子任务的 token/成本聚合上限。父 Run 只限制 `subagentRuns` 和 `remoteToolCalls` 两个计数；并行子任务的模型 token 仍按各自预算计,这是有意接受的风险,等真实成本数据说明有问题再加。

## 9. 最终成功标准

这次优化是否成功，不看新增了多少角色和状态，而看四个结果：

1. 办公调研和文件扫描能稳定委派，父 Agent 上下文明显变小。
2. 复杂任务不能再只靠实现者自己宣布完成。
3. 新流程只用于真正复杂的任务，普通任务的速度和成本不受影响。
4. 每增加一层 Harness，都有 Trace 数据证明它确实提高了成功率。
