# Agent Team 模式（方案 A）开发设计方案

> 状态：方案 A 已确认，待实施（Phase 1）
> 范围：共享 Agent 上层（`src/lib/server/agent`）+ 设置层 + 渠道进度展示；Channel 层收发逻辑零改动
> 读者：执行本方案的工程模型。所有文件路径、行号、行为均已在当前代码库（分支 `desktop-app`，2026-07-05）核实。
> 方案比选记录：见文末附录 A（方案 B/C/D 为何不选）。

---

## 0. 背景与目标

现有 `subagent` 工具把任务委派给一次性的隔离 pi-coding-agent 会话（single / parallel / chain 三种模式），跑完即 `dispose`。三个结构性限制：

1. **成员一次性**：reviewer 发现问题后无法让原 worker 带着已有上下文返工，只能新开 worker 并重塞全部上下文。
2. **编排需预先声明**：chain/parallel 拓扑在一次工具调用里写死，父 Agent 无法按中间结果动态派活、打回、增派。
3. **无跨轮共享状态**。

**Agent Team 模式（方案 A）**：主 Agent 即 Lead，新增 `team` 工具，可按角色拉起**具名、会话持久（run 内）**的团队成员，多轮 `send` 对话式派活，run 结束统一销毁。Phase 1 不做任务板（Lead 用自己的上下文记录分工），不做成员间直接通信。

### 0.1 概念模型

| 概念 | 定义 | 生命周期 |
|------|------|---------|
| **Team** | 每个父 run 至多一个，惰性创建（首次 `spawn`） | 随 run 结束强制销毁，不跨消息持久化 |
| **Member** | `name + role + 持久 pi-coding-agent session + 用量累计` | spawn 创建 → 多轮 send → run 结束或显式 dispose |
| **Role** | 复用现有 markdown 角色定义（`scout`/`planner`/`worker`/`reviewer`） | 不变；`skill-drafter` 是内部元数据角色，**不开放**给 team |

### 0.2 不变式（红线，任何一条被打破即算实现失败）

1. **Channel 层零感知**：team 逻辑全部在共享 Agent 层；渠道只消费新增的 `RunnerUiEvent`，且沿用 P1-190/191 的 best-effort sink 原则（sink 失败不得中断执行）。
2. **无 session 泄漏**：run 结束（正常 / abort / error）后必须无存活成员 session。销毁挂在 runner run 级 `finally`（`runner.ts:2167` 起的清理块）。
3. **禁止嵌套**：成员工具集不含 `team` / `subagent`（现有 `createCustomTools` 只发 read/bash[+edit/write]，天然满足，需测试锁定）。
4. **团队聚合预算先行**：Phase 1 就必须带 团队总工具调用数 + 团队总时长 两个聚合上限；超限后 `spawn`/`send` 返回结构化拒绝（不抛异常，让 Lead 能收尾），并发出终止事件。
5. **上下文卫生**：成员回复进父上下文前必须压缩（复用现有 >6000 字符压缩策略）；team 进度/诊断只走 runtime event / momLog，不得作为对话内容写入模型上下文（prd 既有纪律）。
6. **现有 `subagent` 工具行为零变化**：抽取共享模块属纯重构，`subagent.test.ts` 全部用例必须原样通过。
7. **审批边界不变**：成员触发的 Host Bash 审批沿用 `requestedByDepth = 父深度 + 1` 上提 + 父 runner 去重（`shouldForwardHostBashApproval`），不新增任何自动放行。

### 0.3 非目标（Phase 1 明确不做）

- 任务板 / 成员间直接通信（Phase 2：`team/tasks.json` + `status` 增强）。
- Operator 自定义角色注册表（Phase 2；本期只把写死的 `SUBAGENT_NAMES` 解耦成可扩展结构，不开 UI）。
- 独立 Lead Agent、团队模板 preset、run ledger 持久化（Phase 3）。
- 成员会话跨消息/跨 run 持久化。
- send 期间的模型 fallback：成员 session 绑定 spawn 时选定的模型（fallback 只发生在 spawn 建会话时）；send 中模型报错原样返回给 Lead。

---

## 1. 已核实的代码锚点（实施前请逐一确认仍然成立）

| 锚点 | 位置 | 当前事实 |
|------|------|---------|
| subagent 工具 | `src/lib/server/agent/tools/subagent.ts` | `createSubagentTool()`（1149 行起）；`runSubagentOnce()`（773 行起）内含 session 构建（788-841：SettingsManager/DefaultResourceLoader/`createCustomTools`/`createAgentSession`）、guard 订阅（857 行 `session.subscribe` + `evaluateSubagentEvent`）、独立 deadline 定时器（933 行 `armSubagentDeadline`）、`finally` 中 `session.dispose()`（1007 行）。**这是要抽取复用的主体** |
| 角色注册表 | 同上 49 行 `SUBAGENT_NAMES` 常量 + `loadSubagentRegistry()`（246 行，markdown frontmatter 解析，`cachedRegistry` 缓存）；`getSubagentDefinition()`（283 行，**私有**，需导出） | 五个角色 md 在 `tools/subagent-agents/` |
| 模型解析 | 同上 `resolveSubagentModelCandidates()`（466 行，**私有**，需导出）；级别映射 `haiku/sonnet/opus/thinking` → `settings.modelRouting.subagent*ModelKey` | 候选列表 + 主文本路由兜底 |
| 输出压缩 | 同上 `summarizeSubagentResultsForParent()`（579 行）内嵌 `compressOutput`（>6000 字符截断） | 需抽成可复用的 `compressSubagentOutput()` |
| 运行时守卫 | `src/lib/server/agent/tools/subagentRuntime.ts` | `SubagentExecutionGuard`（预算 + deadline + 结构化 stop reason）、`armSubagentDeadline`、`evaluateSubagentEvent`、`resolveSubagentBudgetLimits`、`DEFAULT_SUBAGENT_DEADLINE_MS = 10min` |
| 工具注册 | `src/lib/server/agent/tools/index.ts:581` | `createSubagentTool({...})` 在 `createMomTools()` 内注册（channel/cwd/workspaceDir/chatId/sessionId/store/artifactDir/getSettings/emitRunnerEvent/runId；**未传 requestedByDepth，默认 0**）；所有工具经 `wrapSerializedTool` 包装；返回数组上已有挂附加成员的先例：`(resultTools as any).wrapTool` |
| 串行策略 | `src/lib/server/agent/tools/toolPolicy.ts:8-19` | `SERIALIZED_TOOL_NAMES` 集合含 `"subagent"`，需加 `"team"` |
| 事件类型 | `src/lib/server/agent/core/types.ts:67` | `RunnerUiEvent` union；`subagent_execution` 变体在 104 行（phase: start/task_start/task_end/end），是 `team_execution` 的样板 |
| 事件消费点 | ① `core/displayFormatter.ts:99`（Web 展示）② `core/runner.ts:908-950`（task 计时记录、hook 触发、`ctx.respond` 进度行 950 行）③ `channels/telegram/runtime.ts:14`（进度标签） | 标签格式化集中在 `src/lib/server/agent/subagentProgress.ts`（`formatSubagentProgressLabel/Summary`、`buildSubagentDiagnostic`） |
| run 级清理 | `core/runner.ts:866` 创建 `localTools = createMomTools({...})`；run 结束统一清理在 **2167 行 `finally`**（unsubscribe、activeRunBudget 置空等） | team 销毁函数在此执行 |
| 预算设置 | `settings/schema.ts:502` `budget: RunBudgetLimits`；`settings/defaults.ts:489`（env `MOLIBOT_MAX_TOOL_CALLS` 等）；`settings/sanitize.ts:682` `sanitizeBudgetSettings` + 936 行接线 | **team 设置照此三件套模式新增** |
| Prompt 组装 | `prompts/prompt.ts`：`buildSubagentSection()`（445 行）；section 拼装处 534 行；拼装作用域内可访问 `options?.settings`（见 523 行 `buildFeaturePluginsSection(options.settings)` 先例）→ **team section 可按 settings 开关条件插入** | |
| 审批深度 | `subagent.ts:1250-1258`：hostApproval 携带 `requestedByDepth: (options.requestedByDepth ?? 0) + 1`；去重在 `runner.ts` `shouldForwardHostBashApproval`（859 行附近） | team 成员照抄 |
| 测试模式 | `tools/subagent.test.ts` | `node --test` + `createSubagentTool({ runSubagent: 注入桩 })` 注入式测试（105/164/182/206 行）；深度传播测试在 270 行 |
| 测试运行命令 | 根 `package.json` | `node --import ./scripts/register-loader.js --import tsx --test <files>` |

**实施前风险验证（Slice 1 第一步）**：确认 `@mariozechner/pi-coding-agent` 的 `session.prompt()` 支持同一 session 多次调用（多轮对话）。父 runner 自己的 agent 即跨轮持久，SDK 语义上应支持；若不支持，Phase 1 改为"成员 = 保留消息历史、每轮重建 session 注入历史"的降级实现，接口不变。

---

## 2. 总体设计

### 2.1 新增文件

```
src/lib/server/agent/tools/
  subagentSession.ts        # 从 subagent.ts 抽取的共享成员会话模块（Slice 1）
  subagentSession.test.ts
  team.ts                   # team 工具（Slice 2）
  team.test.ts
  teamRuntime.ts            # TeamRuntime + TeamBudget（Slice 2）
  teamRuntime.test.ts
src/lib/server/agent/
  teamProgress.ts           # team 事件标签格式化（Slice 4，模式同 subagentProgress.ts）
  teamProgress.test.ts
```

### 2.2 `team` 工具接口（暴露给主 Agent）

```ts
const teamSchema = Type.Object({
  action: Type.String(),                     // "spawn" | "send" | "status" | "dispose"
  role: Type.Optional(Type.String()),        // spawn：scout | planner | worker | reviewer
  name: Type.Optional(Type.String()),        // spawn 可选自定义名；send/dispose 指定成员
  task: Type.Optional(Type.String()),        // spawn（首个任务，必填）/ send（必填）
  sends: Type.Optional(Type.Array(           // send 的并行批量形式（互斥于 name+task）
    Type.Object({ name: Type.String(), task: Type.String() })
  )),
  maxConcurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 4 }))
});
```

语义（每次调用必须有产出，不存在"只建不干活"的空 spawn）：

| action | 行为 | 返回给 Lead |
|--------|------|------------|
| `spawn` | 校验 role ∈ `TEAM_ROLES`（四角色，排除 skill-drafter）、成员数 < `maxMembers`、name 唯一（缺省 `${role}-${序号}`，规则 `^[a-z0-9][a-z0-9-]{0,31}$`）；建持久 session（模型候选 fallback 只在此发生）并执行首个 task | 压缩后的成员输出 + 成员名 |
| `send` | 向既有成员的 session 追加 prompt（成员保留全部历史）；`sends` 批量形式要求目标成员互不相同，按 `maxConcurrency`（默认 2，≤4）并行 | 压缩后输出（批量时按成员分节，格式同 `summarizeSubagentResultsForParent` 的 parallel 分节） |
| `status` | 只读 | 成员表：name / role / model / 轮数 / 累计 usage / 最近 stopReason + 团队预算余量 |
| `dispose` | 销毁指定成员（缺 name 则全部）并从表中移除 | 确认文本 |

错误路径（全部返回带说明的 tool 结果文本，**不抛异常**，Lead 可据此收尾或调整）：未知 action / 未知 role / 未知成员 / 重名 / 超 maxMembers / 团队预算或时长超限 / `sends` 目标重复。

### 2.3 `teamRuntime.ts`

```ts
export interface TeamBudgetLimits {
  maxMembers: number;          // 默认 4
  maxTotalToolCalls: number;   // 团队所有成员累计，默认 72（= 24 × 3）
  maxTotalDurationMs: number;  // 首次 spawn 起算 wall-clock，默认 20min
}

export type TeamStopKind = "team_budget_exceeded" | "team_timeout";

interface TeamMember {
  name: string;
  role: SubagentName;
  definition: SubagentDefinition;
  session: AgentSession;            // 持久，禁止在 send 后 dispose
  model: Model<any>;
  authStorage: AuthStorage;
  turns: number;
  totalUsage: UsageStats;           // 累加每轮 buildUsage 结果
  totalToolCalls: number;           // 累加每轮 guard.snapshot().toolCalls
  lastStopReason?: string;
}

export class TeamRuntime {
  // 构造入参：limits、now?（测试注入时钟）
  spawnAllowed(): { ok: boolean; reason?: string };      // 成员数 + 聚合预算 + 时长
  sendAllowed(): { ok: boolean; reason?: string };       // 聚合预算 + 时长
  register(member: TeamMember): void;
  get(name: string): TeamMember | undefined;
  recordTurn(name: string, usage: UsageStats, toolCalls: number, stopReason: string): void;
  statusSummary(): string;                                // 给 status action 的紧凑文本
  getStopReason(): { kind: TeamStopKind; reason: string } | undefined;
  async disposeAll(): Promise<void>;                      // 幂等；逐成员 try/catch，单个失败不阻断
  memberCount: number;
}
```

预算判定时机：每次 `spawn`/`send` **执行前**检查（`spawnAllowed`/`sendAllowed`），执行后 `recordTurn` 累加。每轮 send 内部仍用一个**新的** `SubagentExecutionGuard`（沿用 `resolveSubagentBudgetLimits` 单轮限额 + `DEFAULT_SUBAGENT_DEADLINE_MS` 单轮 10 分钟 deadline），团队聚合限额叠加在其上。首次超限后 `getStopReason()` 置位，之后所有 `spawn`/`send` 直接拒绝，并触发一次 `team_end` 事件（stopReason `"error"` + errorMessage 为结构化原因）。

### 2.4 `subagentSession.ts`（从 `subagent.ts` 抽取，纯重构）

从 `runSubagentOnce()` 拆出两个可复用函数，`subagent.ts` 改为调用它们（行为不变）：

```ts
// ① 建会话：subagent.ts 788-841 行主体（SettingsManager / ResourceLoader /
//    createCustomTools / createAgentSession），外加模型候选解析。
//    团队成员与一次性 subagent 共用；spawn 时的模型 fallback 在调用方循环候选实现。
export async function buildMemberSession(
  agent: SubagentDefinition,
  model: Model<any>,
  runtime: { authStorage: AuthStorage; modelRegistry: ModelRegistry },
  options: RunSingleSubagentOptions          // 类型随迁移导出
): Promise<AgentSession>;

// ② 跑一轮 prompt：subagent.ts 849-1014 行主体（guard 订阅、armSubagentDeadline、
//    hostBashApproval 提取、momLog 埋点、结果组装），**不含 session.dispose()**。
//    subagent 一次性路径在外层 finally 里自行 dispose；team 路径不 dispose。
export async function promptMemberTurn(
  session: AgentSession,
  agent: SubagentDefinition,
  task: string,
  guard: SubagentExecutionGuard,
  options: RunSingleSubagentOptions,
  startedAt: number
): Promise<SubagentRunResult>;
```

同时从 `subagent.ts` 导出（改私有为公开，签名不变）：`getSubagentDefinition`、`resolveSubagentModelCandidates`、`compressSubagentOutput`（从 `summarizeSubagentResultsForParent` 内嵌函数提出）。`SUBAGENT_NAMES` 保持不变，另加 `export const TEAM_ROLES = ["scout", "planner", "worker", "reviewer"] as const;`。

### 2.5 run 级销毁接线

`createMomTools`（`tools/index.ts`）options 新增：

```ts
registerRunCleanup?: (cleanup: () => Promise<void>) => void;
```

`createTeamTool` 在 TeamRuntime 首次创建时调用 `options.registerRunCleanup?.(() => teamRuntime.disposeAll())`。

`runner.ts`：`run()` 内（866 行 `createMomTools` 调用前）声明 `const runCleanups: Array<() => Promise<void>> = [];`，传入 `registerRunCleanup: (fn) => runCleanups.push(fn)`；在 **2167 行 `finally` 块开头**追加：

```ts
for (const cleanup of runCleanups) {
  try { await cleanup(); } catch (error) { momWarn("runner", "run_cleanup_failed", { runId, chatId: this.chatId, error: String(error) }); }
}
```

（放在 `finally` 开头、`unsubscribe()` 之前即可；abort/error 路径同样经过此 `finally`。）

### 2.6 事件与进度

`core/types.ts` 的 `RunnerUiEvent` union 新增变体（紧跟 `subagent_execution` 之后）：

```ts
| {
    type: "team_execution";
    phase: "team_start" | "member_spawn" | "task_start" | "task_end" | "team_end";
    member?: string;
    role?: string;
    task?: string;
    memberCount: number;                  // 事件时刻的成员数
    stopReason?: "stop" | "aborted" | "error" | "waiting_for_approval";
    errorMessage?: string;
    budget?: RunBudgetSnapshot;           // task_end：该轮 guard 快照
    model?: string;
  }
```

发射时机：首次 spawn → `team_start` + `member_spawn`；后续 spawn → `member_spawn`；每轮 spawn 首任务/send → `task_start`/`task_end`；run 清理或预算终止或显式全量 dispose → `team_end`（带终止原因）。发射一律经 `options.emitRunnerEvent?.()`（与 subagent 相同，天然 best-effort）。

消费点改动（三处，全部是加分支，模式照抄 `subagent_execution`）：

1. `src/lib/server/agent/teamProgress.ts`（新增）：`formatTeamProgressLabel/Summary`、`buildTeamDiagnostic`，文案风格对齐 `subagentProgress.ts`（如 `Team member spawned: worker-api (worker)` / `Team task finished (worker-api): stop`）。
2. `core/displayFormatter.ts:99` 附近加 `team_execution` 分支。
3. `core/runner.ts:949` 附近加 `enqueue(() => ctx.respond(\`_→ ${formatTeamProgressLabel(event)}_\`, false))`。
4. `channels/telegram/runtime.ts` 加同样分支（该文件已 import subagentProgress，加一个 import）。

Phase 1 不加 team 专属 hook（`subagent.task.before/after` 模式的 `team.*` hook 留到 Phase 2）。

### 2.7 设置

三件套（模式照抄 `budget`）：

- `settings/schema.ts`（502 行 `budget` 旁）：

  ```ts
  export interface TeamSettings {
    enabled: boolean;
    maxMembers: number;
    maxTotalToolCalls: number;
    maxTeamDurationMs: number;
  }
  // RuntimeSettings 增加：teams: TeamSettings;
  ```

- `settings/defaults.ts`（489 行 `budget` 旁）：

  ```ts
  teams: {
    enabled: (process.env.MOLIBOT_TEAM_ENABLED ?? "true") !== "false",
    maxMembers: Math.max(1, Number(process.env.MOLIBOT_TEAM_MAX_MEMBERS ?? 4) || 4),
    maxTotalToolCalls: Math.max(1, Number(process.env.MOLIBOT_TEAM_MAX_TOOL_CALLS ?? 72) || 72),
    maxTeamDurationMs: Math.max(60_000, Number(process.env.MOLIBOT_TEAM_MAX_DURATION_MS ?? 1_200_000) || 1_200_000)
  },
  ```

- `settings/sanitize.ts`：`sanitizeTeamSettings()`（照 682 行 `sanitizeBudgetSettings` 写法：数值取整、下限钳制、非法值回退 current），936 行旁接线 `next.teams = sanitizeTeamSettings(next.teams ?? current.teams, current.teams);`。

工具注册 gating：`tools/index.ts` 中 `options.getSettings().teams.enabled` 为 true 才注册 `createTeamTool`（与 581 行 `createSubagentTool` 并列）。Prompt section 同样按 `options?.settings?.teams?.enabled` 条件插入（先例：523 行 `buildFeaturePluginsSection`）。

### 2.8 Prompt 指引（`prompts/prompt.ts`）

新增 `buildTeamSection()`，插在 534 行 `buildSubagentSection()` 之后（条件插入，见 2.7）。要点（英文，风格对齐现有 section）：

- `team(action, role?, name?, task?, sends?)` — spawn named persistent members (`scout`/`planner`/`worker`/`reviewer`), then `send` follow-up tasks to the **same member with its context intact**.
- Use `team` only when the work needs **iteration or rework across steps** — e.g. worker implements, reviewer reports issues, the same worker fixes them. For one-shot delegation keep using `subagent`; for tiny tasks use direct tools.
- Members keep their own context; do not re-paste prior instructions when sending follow-ups.
- Members have the same limited tools as subagents (read/bash, worker also edit/write) and cannot spawn teams or subagents.
- The team shares an aggregate budget; when a spawn/send is refused for budget reasons, wrap up with the best current result instead of retrying.
- Always check `status` before spawning a member you might already have; dispose members you no longer need.

`buildToolsSection()`（静态、无 settings）不改，team 的签名说明完全放在条件插入的 team section 内，保证关闭开关时 prompt 无残留。

### 2.9 日志埋点（momLog，风格对齐 `subagent_*`）

`team_start` / `team_member_spawn` / `team_send_start` / `team_send_end` / `team_budget_abort` / `team_disposed`，字段含 chatId、member、role、turns、usageTotal、stopReason、团队预算快照。

---

## 3. 实施切片

> 每个 Slice 独立可提交、测试可绿。执行顺序固定。统一测试命令：
> `node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/tools/subagent.test.ts src/lib/server/agent/tools/subagentRuntime.test.ts src/lib/server/agent/tools/subagentSession.test.ts src/lib/server/agent/tools/team.test.ts src/lib/server/agent/tools/teamRuntime.test.ts src/lib/server/agent/teamProgress.test.ts`
> （文件尚不存在时从列表中省略。）全量收尾另跑 `pnpm run build` 验 svelte-check。

### Slice 1：抽取共享成员会话模块（纯重构，行为不变）

1. **SDK 验证**：写一个最小 node 脚本或直接查 `node_modules/@mariozechner/pi-coding-agent` 的 session 类型，确认 `session.prompt()` 可重入（同一 session 第二次调用继续历史）。若不可重入，按 §1 末尾的降级实现调整 §2.4 设计并在本文档记录，再继续。
2. 新建 `subagentSession.ts`：按 §2.4 迁出 `buildMemberSession` / `promptMemberTurn`；`subagent.ts` 的 `runSubagentOnce` 改写为「`buildMemberSession` → `promptMemberTurn` → `finally { session.dispose() }`」的组合，函数签名与所有 momLog 埋点、事件行为不变。
3. `subagent.ts` 导出 `getSubagentDefinition`、`resolveSubagentModelCandidates`、`compressSubagentOutput`、`TEAM_ROLES`；`RunSingleSubagentOptions` 类型移到 `subagentSession.ts` 并 re-export。
4. `subagentSession.test.ts`：用桩 session（记录 prompt 调用、可注入 messages/事件）测 `promptMemberTurn` 的 guard 中断、deadline、hostBashApproval 提取、usage 汇总（这些逻辑原先只能通过 subagent 整体测试间接覆盖）。

**验收**：`subagent.test.ts`、`subagentRuntime.test.ts` 全绿且零改动（270 行深度测试等原样通过）；`pnpm run build` 通过。

### Slice 2：TeamRuntime + `team` 工具（核心）

1. `teamRuntime.ts`：按 §2.3 实现 `TeamRuntime`/`TeamBudgetLimits`/`TeamStopKind`，时钟可注入。
2. `team.ts`：`createTeamTool(options)`，options 与 `createSubagentTool` 一致（§1 锚点 index.ts:581 的字段）另加 `registerRunCleanup`；内部：
   - 惰性创建 TeamRuntime（首次 spawn 时），同时注册 run cleanup；
   - `spawn`：`getSubagentDefinition` + 角色白名单 `TEAM_ROLES` + 命名/上限校验 → 循环 `resolveSubagentModelCandidates` 结果逐个 `buildMemberSession`（建会话失败换下一候选）→ `promptMemberTurn` 跑首任务 → `recordTurn` → 压缩输出返回；
   - `send`：单发或 `sends` 批量（复用 `subagent.ts` 的 `mapWithConcurrency`，迁到共享处或复制到 team.ts——**决策：导出复用**）；每轮新建 `SubagentExecutionGuard`；
   - `status` / `dispose` 按 §2.2；
   - 所有业务错误走「结果文本 + isError」返回，不抛；
   - hostApproval 组装照抄 `subagent.ts:1250-1258`（`requestedByDepth + 1`）；
   - 测试注入口：options 可注入 `buildSession` / `promptTurn` 桩（模式同 `createSubagentTool` 的 `runSubagent` 注入）。
3. `tools/index.ts`：options 增加 `registerRunCleanup?`；在 `createSubagentTool` 之后按 `getSettings().teams?.enabled !== false` 注册 `createTeamTool`（Slice 3 前 settings 尚无 `teams` 字段，用可选链 + 默认开，Slice 3 收紧为正式字段）。
4. `toolPolicy.ts:17` 旁 `SERIALIZED_TOOL_NAMES` 加 `"team"`。
5. `runner.ts`：按 §2.5 加 `runCleanups` 收集与 `finally` 执行。
6. 测试（`team.test.ts` + `teamRuntime.test.ts`，全部注入桩，无真实模型）：
   - spawn 返回首轮输出；对同名成员两次 send，桩断言两次 prompt 落在**同一 session 实例**上且历史保留；
   - 超 `maxMembers` 的 spawn、重名 spawn、send 未知成员 → isError 结果文本，不抛；
   - 聚合工具调用数超限：下一次 send 被拒 + `team_end` 事件（stopReason error，errorMessage 含 `team_budget_exceeded` 原因）；
   - 注入时钟推过 `maxTotalDurationMs`：spawn/send 被拒；
   - `registerRunCleanup` 捕获的函数执行后：所有桩 session 的 `dispose` 被调用、TeamRuntime `memberCount === 0`、二次调用幂等；
   - `sends` 目标重复 → 拒绝；`maxConcurrency` 钳制到 ≤4；
   - hostApproval 的 `requestedByDepth` 为 1（照抄 subagent.test.ts:270 模式）；
   - 成员工具集不含 `team`/`subagent`：对 `createCustomTools(agent, …)` 的返回做名称断言（锁定不变式 3）。

**验收**：上述测试全绿；既有 subagent 测试仍绿；`pnpm run build` 通过。

### Slice 3：设置三件套 + 开关 gating + Prompt section

1. `schema.ts` / `defaults.ts` / `sanitize.ts` 按 §2.7 落地（含 sanitize 单测：钳制下限、非法值回退，写进现有 settings 测试文件或新建，参照 `sanitizeBudgetSettings` 的既有测试位置）。
2. `tools/index.ts` gating 收紧为 `options.getSettings().teams.enabled`。
3. `teamRuntime` 的 limits 来源：`createTeamTool` 内从 `getSettings().teams` 读取。
4. `prompts/prompt.ts`：`buildTeamSection()` 按 §2.8 实现，534 行处条件插入：`...(options?.settings?.teams?.enabled ? ["", buildTeamSection()] : [])`（写法先例：523 行）。
5. 测试：`teams.enabled=false` 时 `createMomTools` 结果不含 `team` 工具、`buildSystemPrompt` 输出不含 team section；`enabled=true` 反之。

**验收**：测试绿；`/api/settings` PUT 带 `teams` 字段经 sanitize 往返正常（现有 settings API 流程自动覆盖，补一条 sanitize 单测即可）。

### Slice 4：事件与跨渠道进度

1. `core/types.ts`：加 `team_execution` 变体（§2.6）。
2. `team.ts`：在 spawn/send/dispose/预算终止各时机发射事件（§2.6 时机表）；run cleanup 里若 team 存在且未发过 `team_end`，补发（stopReason 取 run 实际终态：正常 stop / aborted）。
3. `teamProgress.ts` + 三个消费点分支（§2.6 清单）。
4. 测试：`team.test.ts` 补事件序列断言（`team_start → member_spawn → task_start → task_end → … → team_end`，含预算终止路径）；`teamProgress.test.ts` 测标签文案；沿用「emitRunnerEvent 抛错不影响工具结果」的断言（先例见 subagent 测试）确保 best-effort。

**验收**：测试绿；手动冒烟：Web 会话里让主 Agent spawn 一个 scout 并 send 一次追问，Web/Telegram 能看到 `_→ Team …_` 进度行，run 结束后日志出现 `team_disposed`。

### Slice 5：设置 UI + i18n + 文档收尾

1. `src/routes/settings/system/+page.svelte`（budget 设置所在页）新增「Agent Team」分组：`enabled` 开关（**必须用 `IosSwitch`**，CLAUDE.md 规则）、maxMembers / maxTotalToolCalls / maxTeamDurationMs 数值输入；样式用语义类名（DESIGN.md §CSS Class Naming Convention），中英文案齐备。
2. `/settings/agents`（`src/routes/settings/agents/+page.svelte`）内置 Subagent 卡片区加一行只读说明：team 模式启用状态与四个可用 team 角色（数据复用 `/api/settings/subagents` GET，响应增加 `team: { enabled, roles }` 字段，改 `src/routes/api/settings/subagents/+server.ts`）。
3. 文档（项目流程要求）：
   - `prd.md`：P1 表格新增一行（编号取当前最大 P1-xxx + 1，执行时 `grep -oE "P1-[0-9]+" prd.md | sort -t- -k2 -n | tail -1` 确认），标题 "Agent Team mode (persistent members, lead orchestration)"，验收标准引用本文档 §4；
   - `features.md` + `CHANGELOG.md`：交付说明（同一 slice 内完成，桌面/服务端条目规则见 AGENTS.md）；
   - 本文档状态改为「已交付（日期）」并记录实施中的决策偏差。

**验收**：`pnpm run build` + 根 svelte-check 通过；设置页开关往返生效（关→新会话无 team 工具）。

---

## 4. Phase 1 总验收标准

1. 父 Agent 可 spawn ≤ `maxMembers` 个具名成员；对同一成员多次 `send`，第二轮回复可引用第一轮上下文（注入桩测试断言同 session 复用；真实模型冒烟一次）。
2. 团队聚合预算（总工具调用数 / 总时长）任一超限：后续 spawn/send 被结构化拒绝，Lead 收到可读原因，`team_end` 事件带终止原因；成员被 dispose。
3. run 正常结束 / abort / error 后无存活成员 session（cleanup 测试 + `team_disposed` 日志）。
4. 成员触发的 Host Bash 审批出现在父会话、`requestedByDepth = 1`、去重行为与 subagent 一致。
5. Web / Telegram 可见 team 生命周期进度（best-effort，sink 抛错不影响执行）。
6. 成员工具集不含 `team` / `subagent`（测试锁定）。
7. `teams.enabled=false` 时：无 team 工具、prompt 无 team section、其余行为与今天完全一致。
8. 既有 `subagent` 全部测试零改动通过（重构不变性）。

---

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `session.prompt()` 不可重入 | Slice 1 第一步先验证；降级路径已定义（历史重放式重建 session，接口不变） |
| token/成本放大 | 聚合预算 Slice 2 即生效；成员回复强制压缩；prompt 明确"预算拒绝后收尾不重试" |
| 成员 session 泄漏 | run 级 `finally` cleanup + `disposeAll` 幂等 + 单轮 10min deadline 兜底 |
| 长驻成员的 API 连接/内存占用 | Phase 1 成员仅 run 内存活（一条消息的处理周期），与现有 parallel subagent 峰值相当；maxMembers 钳制 |
| Lead 滥用 team 做一次性任务 | prompt section 明确分工（迭代/返工才用 team）；`status` 引导复用已有成员 |
| 与 chain/parallel 语义混淆 | subagent section 不动，team section 单独成块并写明对比 |

---

## 附录 A：方案比选结论（2026-07-05 已确认）

- **A 主 Agent 即 Lead + 持久成员会话**：选定。复用现有预算/审批/事件/模型路由全链路，可观测性最好。
- **B 独立 Lead Agent**：嵌套深度 +1，审批链/预算归属/可观测性倒退；如需可后续叠加在 TeamRuntime 上，不冲突。
- **C 声明式团队模板**：解决不了动态编排；收编为 Phase 3 preset（一条指令拉起 code-team 等）。
- **D 黑板式自治 swarm**：成本不可控，与父 runner 统一预算/审批架构冲突，不做。
- **Phase 2 预告**：任务板（`team/tasks.json` + status 增强）、operator 自定义角色注册表 + UI、`team.*` hooks、chain review 打回循环收编。
- **Phase 3 预告**：团队模板 preset、run ledger 持久化（prd 既有 P1 建议）、Desktop 团队进度面板。
