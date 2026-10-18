# Durable 唤醒队列与执行器硬化 设计

> 文件职责：技术设计 / 系统提案（`docs/designs/`）。本文只出方案与验收标准，**不改代码**。
> 需求 / 验收视角的 spec 见 [`docs/requirements/durable-wakeup-queue-and-executor-hardening.md`](../../requirements/durable-wakeup-queue-and-executor-hardening.md)。
> 状态：Draft，待批准。
> 日期：2026-10-17。
> 范围：`src/lib/server/agent/durable/**`、`src/lib/server/agent/plans/**`、`src/lib/server/agent/events*.ts`、`src/lib/server/app/runtime.ts`。
> 前置：pi-durable 1.3.0 对照分析（本次对话）；相关旧文 [`event-run-timeout-retry.md`](event-run-timeout-retry.md)。

---

## 0. 一句话结论

durable 的执行状态**已经**在 SQLite（`durable-execution.sqlite`），真正需要搬走的是**唤醒触发器**：把「每次版本推进写一个 JSON 事件文件、靠目录 watcher 扫描」改成「**与状态变更同一事务写入 `durable_wakeups` 表、由 claim + worker 消费**」；同批完成心跳、CAS-safe finalize、存储错误分级、进度检查点、取消级联与 inspect，把执行器从「能跑」推到「崩溃/并发/多进程都讲得清」。

---

## 1. 事实更正（先对齐现状）

上一轮讨论里“durable 存在 JSON 里”这个前提是错的，先修正：

| 数据 | 实际存储 | 证据 |
| --- | --- | --- |
| 执行 / 计划版本 / 步骤 / attempt / 副作用 / 审批 / 证据 | **SQLite** `data/db/durable-execution.sqlite` | `storagePaths.durableExecutionDbFile`（`infra/db/storage.ts:16`）、`store.ts:636` |
| 唤醒触发器 | **JSON 文件** `data/system/bots/owner/events/durable-execution-<id>-v<version>.json` | `durable/events.ts:56`、`durable/events.ts:20` |
| 事件执行租约 | **SQLite** `settingsDbFile` | `eventsLeaseStore.ts:149` |
| 会话历史 | **JSONL** `<sessionId>.jsonl` | `agent/session/store.ts:300` |

由此得出两个关键事实：

1. **唤醒这条链路已经是“半 DB、半文件”**：租约在 SQLite，payload 在文件。两个真相源天然会分叉。
2. **入队不是事务的一部分**：`finishAttempt()` 提交后，调用方再 `ensureQueuedEvents()` 扫一遍 queued/verifying 并写文件（`runtime.ts` 多个位置、`coordinator.ts:236`）。两步之间崩掉 =「DB 说该跑，但没有触发器」。

---

## 2. 现状与问题清单

### 2.1 唤醒时序（当前）

```text
finishAttempt()/transitionStatus()  ──COMMIT──▶  DB 状态=queued
        │
        └─ ensureQueuedEvents(owner)  ──▶  readdir/SQL 扫 queued+verifying
                                            └─ 每个 execution 写一个 v<version>.json
EventsWatcher(watch + 100ms debounce + 1s tick)
        └─ handleFile → runtime.run(event, filename) → claimAttempt → runner
```

### 2.2 已核实的问题（按严重度）

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P0-1 | 入队与状态提交不在同一事务 | `runtime.ts:707`、`coordinator.ts:236` | 崩溃窗口内 execution 停 `queued` 无触发器，只能等重启或 `handleSkippedEvent` 转人工 |
| P0-2 | `heartbeat()` 没有调用者；lease 复用 `events.executionTimeoutMs`（默认 10 分钟） | `store.ts:1694`（全仓无调用）、`app/runtime.ts:748` | 长 attempt 的租约在运行中过期；多进程/双开时语义失效 |
| P0-3 | `reconcileOrphanedAttempts` 只看 `lease_owner_id != 本进程`，不看 `lease_expires_at` | `store.ts:1800` | 第二个进程一启动就会把另一个进程**正在跑**的 attempt 标 `interrupted`（单实例假设写在 `eventsLeaseStore.ts:22` 注释里） |
| P0-4 | `finishAttempt` 无 CAS 重试；catch 里用旧 `expectedVersion` 再写一次 | `runtime.ts:722-738` | UI 在最后时刻 `answerDecision`/`resolveApproval` bump version → attempt 永久 `running` 到下次启动 |
| P0-5 | 所有异常一律 `recovery_required`，存储错误无分级、无 fatal 闩锁 | `runtime.ts:722` | 磁盘/DB 损坏会被当业务失败继续跑；坏状态扩散 |
| P1-1 | durable 事件文件无自动清理，`knownFiles` 常驻 | `durable/events.ts`、`events.ts:327` | 每个版本一个文件，磁盘与内存慢性增长 |
| P1-2 | 恢复只在启动时跑一次 | `app/runtime.ts:752` | 漏掉的事件只能转人工 |
| P1-3 | 崩溃粒度 = 整步 | 设计如此（step = 一次 attempt） | 一个工具调用失败 → 整步 `uncertain` |
| P1-4 | 取消不保证级联到派生 subagent/后台工作 | `runtime.ts:486` 只 abort 当前 attempt | 父计划停了，子会话可能还在跑 |
| P1-5 | 无执行器级 inspect（live attempt/lease/uncertain/阻塞原因） | 仅有 plan projection | 排查卡住成本高 |
| P2-1 | 无 `journal_mode=WAL` | `store.ts:640` 只有 `busy_timeout`/`foreign_keys` | 写事务挡读、fsync 更重 |
| P2-2 | `getDetail()` 一次 7 张表，`runtime.ts` 内 12 处调用 | `store.ts:1110` | 计划越长越慢，热路径重复全量 load |
| P2-3 | `store.ts` 2669 行，schema/CRUD/状态机/事务混在一起 | `store.ts` | 改动半径大，新增写路径容易漏 version |
| P2-4 | 无执行语义版本 | 无 `engine_version` | 未来改 attempt/verification 语义时，老在途执行被新代码直接解释 |
| P2-5 | 无 storage 抽象 / conformance / benchmark | 直接 `new DatabaseSync` | 多实例/云端迁移成本高 |

---

## 3. 目标与非目标

### 3.1 目标

1. durable 唤醒**单一真相**：`durable_wakeups` 表；入队与状态变更同事务、原子可见。
2. 唤醒消费具备 claim、幂等、过期丢弃、退避重试、容量控制。
3. 崩溃窗口内不丢唤醒、不重复执行；重启后自愈。
4. 租约真实有效：心跳续租；恢复只回收过期租约。
5. finalize 不因 CAS 冲突卡死；存储错误 fail-stop。
6. 保留现有产品语义：副作用分级、幂等键、审批、验收标准、预算与配额**不变**。
7. 旧 JSON 事件文件平滑迁移并清理。
8. 补齐 pi-durable 对照中值得学的运维面：进度检查点、取消级联、inspect。

### 3.2 非目标

- 不把 `memory-reflection` / `daily-materials` / `session-auto-archive` / 用户可见提醒 / 周期任务的事件系统改成 DB。它们仍然适合文件 + JSON（可读、可手工触发、可在设置页展示）。
- 不改会话历史 JSONL（另立 spec）。
- 不引入 Chord 文档/replica/fork 体系。
- 不把 SQLite 换成异步 facade（本 spec 单实例假设不变）。
- 不改副作用分类、验收标准、审批 scope 的产品语义。

---

## 4. D1：`durable_wakeups` 表

### 4.1 DDL

放在 `durable-execution.sqlite`（与 `durable_executions` 同库，才能同事务入队）。

> 依据 ADR 0004：带状态机/并发/崩溃恢复语义的状态必须进数据库；同一所有者作为一个聚合写入的多张表属于同一个有界上下文文件。唤醒由 Durable Execution 聚合拥有，因此不另起数据库文件。

```sql
CREATE TABLE IF NOT EXISTS durable_wakeups (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
  expected_version INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('advance','verify','capacity','resume','control','retry')),
  run_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','done','discarded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  claimed_by TEXT,
  claimed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (execution_id, expected_version)
);
CREATE INDEX IF NOT EXISTS idx_durable_wakeups_due
  ON durable_wakeups(status, run_at);
CREATE INDEX IF NOT EXISTS idx_durable_wakeups_execution
  ON durable_wakeups(execution_id, created_at DESC);
```

约定：

- `expected_version`：入队时 execution 的版本；消费时与当前版本比对，不一致直接 `discarded`（等价现在的“事件只是触发器”）。
- `reason`：只用于观测与退避策略，不参与状态机。
- `max_attempts`：worker 级重试上限（默认 5）；业务失败**不**由 worker 重试。
- 保留策略：`done`/`discarded` 保留 7 天（可配置），之后按批删除；`failed` 永久保留（可被 inspect 看到）。

### 4.2 状态机

```text
pending ──claim──▶ claimed ──runtime ok──▶ done
   ▲                   │
   │                   ├─ version 不符/执行已终态 ──▶ discarded
   │                   ├─ 可重试失败 & attempts<max ──▶ pending（run_at 退避）
   │                   └─ 不可重试/超限 ──▶ failed
   └── 新的版本推进写入新行（UNIQUE 幂等）
```

### 4.3 不变量

1. **同一 `(execution_id, expected_version)` 至多一行**（UNIQUE + `INSERT OR IGNORE`）。
2. **pending/claimed 行数按 execution 计不超过 2**：新版本入队时，把旧版本仍为 pending 的行标 `discarded`。
3. **claimed 行必须能被执行器解释**：`claimed_by` 记录 `PROCESS_OWNER_ID`；进程重启后，claimed 且 `claimed_at` 过期的行回到 pending（由启动 reconcile 处理）。
4. **唤醒不改变业务状态**：worker 只负责调用 `runtime.run`，状态由 runtime 的 CAS 写决定。

### 4.4 与 `next_run_at` 的关系

- `durable_executions.next_run_at` 保留，作为**投影/兼容字段**（UI 显示“下次唤醒时间”）。
- 调度真相以 `durable_wakeups.run_at` 为准；两者在同一事务里写入，必须一致。
- 后续可删 `next_run_at` 的读取点，仅保留投影；不在本 spec 移除列（避免迁移风险）。

---

## 5. D2：事务内入队

### 5.1 写入点清单

所有会“让执行重新可跑”的写，都必须在**同一个 `BEGIN IMMEDIATE` 事务**里插入 wakeup：

| 写入点 | 现状 | 改动 |
| --- | --- | --- |
| `finishAttempt` → `queued`/`verifying` | 提交后 `ensureQueuedEvents` 扫 | 在 `finishAttempt` 内 `enqueueWakeup(tx, …)` |
| `transitionStatus` → `queued`（resume/approval/decision） | 调用方各自 `ensureQueuedEvents` | `transitionStatus` 内按目标状态入队 |
| `deferQueued`（容量/退避） | 写 `next_run_at` 后调用方扫描 | 同事务写 wakeup（`reason='capacity'`/`'retry'`，`run_at=nextRunAt`） |
| `claimAttempt` 失败（预算/租约） | 无 | 预算耗尽 → 转 `partial`；租约被占 → 不重复入队 |
| `requestControl` / `settleControl` | 写完 control 后扫描 | `settleControl` 转入 `paused` 时清掉 pending wakeup |
| 计划创建/批准/修订（`plans/service.ts`） | 调用方扫描 | 状态变更方法内部入队；service 不再负责调度 |
| 启动 reconcile | 扫表 + 扫文件 | 只扫 wakeup 表 + 迁移文件 |

设计原则：**调度是 store 的不变量，不是调用方的责任**。`ensureQueuedEvents` 退化为一次性迁移/兜底工具，正常路径不再调用。

### 5.2 接口草图

```ts
// store.ts
/** 已持有事务时用这个；调用方负责 BEGIN/COMMIT。 */
enqueueWakeupInTx(input: {
  executionId: string; expectedVersion: number; reason: WakeupReason; runAt?: Date;
}): void;

/** 独立调用：内部自行开事务（迁移脚本、兜底扫描用）。 */
enqueueWakeup(input: {
  executionId: string; expectedVersion: number; reason: WakeupReason; runAt?: Date;
}): void;

// 启动兜底 / 迁移
enqueueDueWakeups(ownerId: string, now?: Date): number;

// coordinator 对外（兼容旧调用方，内部改为 enqueueDueWakeups）
ensureQueuedEvents(ownerId: string): number;
```

实现要点：

- `INSERT INTO durable_wakeups … ON CONFLICT(execution_id, expected_version) DO NOTHING`。
- 插入后 `UPDATE durable_wakeups SET status='discarded' WHERE execution_id=? AND expected_version<>? AND status='pending'`。
- 所有写仍在 `BEGIN IMMEDIATE` + version CAS 下；wakeup 行本身不再单独 bump execution version。

---

## 6. D3：claim 与 worker

### 6.1 claim

```ts
claimDueWakeups(now: Date, limit: number, ownerId: string): WakeupRow[] {
  this.db.exec("BEGIN IMMEDIATE");
  try {
    const rows = this.db.prepare(`
      SELECT * FROM durable_wakeups
      WHERE status = 'pending' AND run_at <= ?
      ORDER BY run_at ASC, created_at ASC
      LIMIT ?
    `).all(now.toISOString(), limit);
    const claimed: WakeupRow[] = [];
    for (const row of rows) {
      const res = this.db.prepare(`
        UPDATE durable_wakeups
        SET status='claimed', claimed_by=?, claimed_at=?, attempts=attempts+1, updated_at=?
        WHERE id=? AND status='pending'
      `).run(ownerId, nowIso(now), nowIso(now), row.id);
      if (Number(res.changes ?? 0) > 0) claimed.push({ ...row, status: "claimed" });
    }
    this.db.exec("COMMIT");
    return claimed;
  } catch (e) { this.db.exec("ROLLBACK"); throw e; }
}
```

并发保证：`BEGIN IMMEDIATE` 在单库上串行化写；多进程时后到者看到 `changes=0`，不会重复消费。

### 6.2 worker

```ts
class DurableWakeupWorker {
  start(): void;   // 1s tick + store.subscribe(notify) 立即唤醒
  stop(): Promise<void>; // 等当前 in-flight 结束
}
```

- 循环：`claimDueWakeups(now, batch=4)` → 逐条 `runtime.runWakeup(row)` → 按结果 `done` / 退避 `pending` / `failed`。
- **唤醒时机**：进程内 `store.notify()` 触发即时 tick（和现有 `plans.subscribe` 一样）；跨进程/重启靠 1s 轮询兜底。现在 watcher 本身就是 100ms debounce + 1s tick，延迟不劣化。
- **串行度**：同一 execution 同时至多一条 claimed；不同 execution 可并发，受 `maxActiveExecutions` 与现有队列位置（`queuePosition`）控制。
- **关闭语义**：`stop()` 等在跑的 wakeup 结束；未完成的 claimed 行保持 claimed，下次启动由 `recoverStaleClaims()` 回到 pending（lease 语义见 D5）。

### 6.3 worker 重试与业务失败

| 失败类型 | 处理 |
| --- | --- |
| 拿不到 lease / execution 已终态 / version 不符 | `discarded`（不是错误） |
| 进程级瞬时错误（DB busy、runner 重建失败） | 退避 `pending`：`min(30s × 2^attempts, 30min)` + ±20% jitter |
| 业务失败（模型/工具/验证） | **不重试**：由 `runtime` 写 `recovery_required`/`failed`，wakeup 标 `done` |
| 存储错误 | store fatal（D6），worker 停止 claim |

> 这条边界很重要：pi-durable 的 task fault 是终态，重试由业务决定；worker 不要偷偷重放有副作用的 attempt。

---

## 7. D4：JSON 事件迁移

### 7.1 启动迁移（幂等）

```text
for file of readdir(eventsDir) where name ~ /^durable-execution-(.+)-v(\d+)\.json$/:
  parse JSON → executionId, expectedVersion
  if execution 不存在或已终态        → 标记 migrate-discarded，删除
  if execution.version !== expectedVersion → 标记 stale，删除
  if execution.status ∉ {planned,queued,verifying,recovery_required} → 删除
  INSERT OR IGNORE wakeup(executionId, expectedVersion, reason='advance')
  删除文件
write marker: durable_wakeup_migration_v1 = done
```

- 迁移期间不启动 file watcher 的 durable 分支；迁移完成后 durable 事件不再生成。
- 迁移日志：`{ scanned, enqueued, stale, discarded, failed }` 写 `momLog`，并在 inspect 中可见。
- 失败重试：单个文件解析失败 → 移动到 `events/failed/`，不阻塞启动；下次启动重试（最多 3 次后人工）。

### 7.2 双轨与回滚

- 配置 `MOLIBOT_DURABLE_WAKEUPS=file|db|both`（默认 `both`，一版后改 `db`）。
- `both`：事务内入队 + 仍写文件；worker 消费 DB，文件由 watcher 消费但**先做版本去重**（CAS 已保证重复触发无害）。
- 回滚：`file` 模式恢复旧路径；DB 中 pending 行保留，下次切回 `db` 继续消费。
- 删除计划：`db` 稳定运行 2 个版本后移除 `enqueueDurableExecutionEvent` 与 `runtime.run(event, filename)` 的 `filename` 参数。

---

## 8. D5：心跳与 lease（借鉴 pi-durable）

### 8.1 心跳

- attempt 持有期间每 `leaseDurationMs / 3` 调 `store.heartbeat(executionId, PROCESS_OWNER_ID, leaseDurationMs)`。
- 心跳失败（`changes=0`）→ 说明租约已被回收/版本已变：立即 abort 当前 attempt，不再写业务状态（交给对方/recovery）。

### 8.2 lease 来源解耦

- 新增 `settings.durable.leaseDurationMs`（默认 10 分钟），**不再复用** `events.executionTimeoutMs`（`app/runtime.ts:748` 当前就是这么写的）。
- `events.executionTimeoutMs` 继续只管事件级超时。

### 8.3 恢复判定

```ts
reconcileOrphanedAttempts(now) {
  // 只回收「owner 不是本进程」且「lease 已过期」的 attempt
  WHERE status IN ('running','verifying')
    AND lease_owner_id IS NOT NULL
    AND lease_owner_id != ?
    AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
}
```

- 启动时旧进程的 lease 可能尚未过期。独立维护周期持续回收过期孤儿，不要求再次重启；活跃 execution lease 和本 worker 的在途认领不回收。
- 实例保护：启动时认领 `durable_runtime_instances`，遇到有效的其他实例租约时暂不消费并周期重试。实例心跳独立于 worker 的任务等待，续期与启动使用相同租约时长，文件模式同样续期。
- 进程正常退出：`releaseAllLeases(PROCESS_OWNER_ID)`，把 running 重置为 pending 并清 `claimed_by`。

---

## 9. D6：CAS-safe finalize 与存储 fatal（借鉴 pi-durable）

### 9.1 finalize 重试

```ts
function retryOnConflict<T>(work: () => T, attempts = 3): T {
  for (let i = 0; ; i++) {
    try { return work(); }
    catch (e) {
      if (!(e instanceof DurableExecutionConflictError) || i >= attempts) throw e;
      // 重新读取当前 version 后重试
    }
  }
}
```

- `finishAttempt` 的调用点统一走 `retryOnConflict(() => store.finishAttempt({...currentVersion()}))`。
- 3 次仍冲突 → 不吞：抛给上层，按 D6.2 处理；禁止 `attempt_failure_persist_failed` 后静默返回。

### 9.2 存储错误分级（对齐 pi-durable 三原则）

| 类别 | 判定 | 行为 |
| --- | --- | --- |
| 存储错误 | `SQLITE_IOERR`/`SQLITE_CORRUPT`/`SQLITE_FULL`/`SQLITE_READONLY`/反序列化失败 | `store.fatal(error)`：拒绝新 claim、停 worker、所有 pending wait 以 `DurableExecutionStoreFailed` 结束、`store.closed` resolve，交 supervisor 重启 |
| 请求错误 | 未知 execution / version 冲突 / 非法状态转移 | 只失败这一次调用 |
| 业务错误 | runner/模型/工具/验证失败 | 只失败这次 attempt，按现有 `recovery_required`/`failed` 语义 |

- `runtime.run` 的 catch 先分类，再决定写 `recovery_required` 还是 fail-stop。
- `store.closed` 与 `app/runtime.ts` 的 supervisor 对接：记录 `momError("durableExecution","store_fatal")`，避免继续接新计划。

### 9.3 审计不变量

- 任何 attempt 进入 `running` 后，终态必须由三类写之一落地：`finishAttempt`、reconcile、store fatal。禁止“写完 started 就再没人负责”。

---

## 10. D7：进度检查点（把 `uncertain` 缩小）

- attempt 内每完成一个工具调用（`onToolSideEffectReceipt` 已有钩子）追加一条 attempt 级进度记录：

```sql
CREATE TABLE IF NOT EXISTS durable_attempt_progress (
  attempt_id TEXT NOT NULL REFERENCES durable_attempts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  summary TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, seq)
);
```

- 工具进度只用于诊断；并行工具的完成时间不能证明另一个副作用已确认。`prepareRecovery` 检查整步的 intent：`pure`/`idempotent` 可整步重跑，`queryable` 走探针，`non_idempotent` 先转人工核对。已有回执也不能阻止整步重放时再次调用外部系统。
- 不在每次 token 流上落库（沿用当前 100ms 级流式提交边界），只记工具边界。

---

## 11. D8：取消级联

- `cancel`/`pause` 写入 control 后：
  1. abort 当前 attempt（已有 100ms 轮询，保留）；
  2. 枚举该 plan 派生的工作（`sourceUiSessionId` 子会话、`subagent` 任务、在跑的工具租约），逐个 abort；
  3. 等 quiescence（已有 `awaitToolQuiescence`）后再写终态。
- 语义对齐 pi-durable：父停止必须先停 owned work；需要“父停子不停”的场景显式标记 background（本 spec 只做 plan → 子会话/subagent 的默认级联）。
- 子工作无法停止时：`cancel` 进入 `recovery_required` 并报告“仍有派生工作”，不要假装已停。

---

## 12. D9：inspect（运维面）

只读接口（HTTP + 内部）：

```ts
durable.inspect(executionId) => {
  execution, attempt, lease: { owner, expiresAt, heartbeatAt },
  wakeups: WakeupRow[],
  uncertainSteps, blockedReason,
  progress: { lastCompletedTool, pendingTools },
  queuePosition, nextRunAt
}
```

- 计划详情页加“诊断”抽屉：lease 剩余、下次唤醒、未完成 wakeup、uncertain 原因。
- 目标：出现“卡住”时不再依赖日志拼时间线。

---

## 13. D10：存储层（按收益排序，可独立上线）

1. **WAL + NORMAL**：`store.ts:640` 增加
   `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`（对齐 pi-durable `dist/storage/sqlite/node.js:161`）。
   预期：写不挡读、崩溃最多丢最后一个事务、不损坏。
2. **窄查询**：热路径不再 `getDetail()`（7 张表 × 12 处/run）。新增
   `getVersion(id)`、`getCurrentSteps(id, planVersion)`、`getAttempt(id)`、`getPendingWakeups(id)`；`getDetail` 只给 UI/验收。
   验收：单步 attempt 的 SQL 行数从 O(历史) 降到常量级（目标 ≤ 8 次窄查询）。
3. **`engine_version`**：`durable_executions` 加 `engine_version INTEGER NOT NULL DEFAULT 1`；恢复时按版本迁移或拒绝（为未来 execution 语义变更留位）。
4. **store 拆分**（纯搬家，不改行为）：`store/schema.ts`、`store/executions.ts`、`store/plans.ts`、`store/attempts.ts`、`store/effects.ts`、`store/wakeups.ts`；`DurableExecutionStore` 只保留事务与不变量。目标：单文件 ≤ 600 行。
5. **storage 抽象**（可选，触发条件：要多实例/云端）：抽 `Storage` 接口 + 抄 pi-durable 的 `registerStorageConformance()` 与 benchmark。本 spec 不默认做。

---

## 14. 明确不做

- 不搬 `memory-reflection`、`daily-materials`、`session-auto-archive`、周期任务、用户提醒的事件文件体系（ADR 0003：Runtime Task 仍是 watched-event JSON 的 CRUD 聚合）。
- 不把会话历史 JSONL 迁 SQLite。
- 不引入 Chord 的文档/replica/watch/fork。
- 不把 worker 做成“失败自动重放 attempt”：有副作用的步骤必须走 `prepareRecovery`。
- 不为对齐 pi-durable 而改副作用分类或验收语义。

---

## 15. 发布计划

| 阶段 | 内容 | 出口条件 |
| --- | --- | --- |
| S0 | 加 `durable_wakeups` + 事务内入队 + 迁移脚本；worker 以 `both` 模式双跑 | 迁移 0 丢失；新旧两条路径都只执行一次 |
| S1 | 心跳 + reconcile 过期判定 + finalize CAS 重试 | 双进程模拟下无抢跑；100 次 finalize 竞争 0 卡死 |
| S2 | 存储错误分级 + 窄查询 + WAL | 注入 IOERR 后 fail-stop 可观测；单步查询次数达标 |
| S3 | 默认切 `db`，删除 durable 文件路径与 `filename` 参数 | 一个版本无文件生成；旧目录清空 |
| S4 | 进度检查点 + 取消级联 + inspect | 崩溃矩阵（工具前/中/后）恢复粒度正确 |

回滚：S0–S2 每一步都能单独回退；`both` → `file` 只影响调度路径，不影响数据。

---

## 16. 测试与验收

### 16.1 必测用例

**唤醒队列**
1. `enqueueWakeup` 与状态提交同一事务：注入 commit 前崩溃 → 重启后仍能消费（且只消费一次）。
2. 100 个并发 claim 同一行 → 恰好 1 个成功。
3. 版本推进后旧 pending 行变 `discarded`，不会被消费。
4. `attempts` 达上限 → `failed`，inspect 可见原因。
5. `deferQueued` 的 `run_at` 与 wakeup 行一致；到点前不 claim。
6. 迁移：20 个文件（5 过期、2 未知执行）→ 5 条 pending、2 条 discarded、文件清空；重复启动幂等。

**租约与恢复**
7. 心跳续租：attempt 超过 `leaseDurationMs` 仍持有租约；第二个 owner 不能 claim。
8. 第二个进程启动：只回收**已过期**租约；未过期租约拒绝启动（实例断言）。
9. 进程崩溃后重启：running → pending，steps → uncertain，wakeup 重新可消费。

**finalize 与错误**
10. 并发 `resolveApproval` + `finishAttempt`：CAS 重试后成功；100 次竞争 0 个 attempt 卡 running。
11. 注入 `SQLITE_IOERR`：`store.closed` resolve、worker 停止、pending wait 全部 reject、后续 claim 被拒。

**回归**
12. 现有 `src/lib/server/agent/durable/**`、`plans/**`、`settings/**` 用例全绿。
13. 崩溃矩阵（intent 前 / 外部成功后未提交 / 结果提交未投影）执行次数与终态正确。

### 16.2 机器验收

- 唤醒相关新用例 ≥ 15 项；
- `pnpm check` 0 错误；
- `test:service-bootstrap`、`test:desktop-chat`、`test:projects`、`test:decision` 全绿；
- 迁移日志字段完整，inspect 能读到 wakeup/lease。

---

## 17. 任务拆解

| # | 任务 | 文件 | 估时 | 依赖 |
| --- | --- | --- | --- | --- |
| T1 | `durable_wakeups` schema + 索引 + 迁移版本 | `durable/store.ts`（暂不拆分） | 0.5d | — |
| T2 | `enqueueWakeup` / `enqueueDueWakeups` / claim / finish | 同上 | 1d | T1 |
| T3 | 写入点改造（finishAttempt/transitionStatus/deferQueued/control） | `store.ts`、`coordinator.ts` | 1d | T2 |
| T4 | `DurableWakeupWorker`（tick + notify + 退避 + 关闭） | 新 `durable/wakeupWorker.ts` | 1d | T2 |
| T5 | JSON 文件迁移 + `both/file/db` 配置 + 清理 | `durable/events.ts`、`app/runtime.ts` | 0.5d | T2 |
| T6 | 心跳定时器 + lease 配置解耦 + instance 断言 | `runtime.ts`、`app/runtime.ts`、settings | 1d | T1 |
| T7 | reconcile 过期判定 + 正常退出释放 | `store.ts`、`coordinator.ts` | 0.5d | T6 |
| T8 | `retryOnConflict` + finalize 接入 + fatal latch | `runtime.ts`、`store.ts` | 1d | T3 |
| T9 | 存储错误分类 + `closed` 对接 supervisor | `runtime.ts`、`app/runtime.ts` | 0.5d | T8 |
| T10 | 窄查询 + WAL + `engine_version` | `store.ts` | 1d | T1 |
| T11 | 进度检查点表 + `prepareRecovery` 使用 | `store.ts`、`runtime.ts` | 1d | T3 |
| T12 | 取消级联 | `runtime.ts`、`plans/service.ts` | 1d | T6 |
| T13 | inspect（查询 + HTTP + UI 抽屉） | `store.ts`、`routes/api/desktop/plans`、UI | 1.5d | T10 |
| T14 | 测试与崩溃矩阵 | 各 `*.test.ts` | 2d | 全程 |
| T15 | store 拆分（纯搬家） | `durable/store/*` | 1.5d | T10 |

总计约 14 人日；S0–S1（T1–T7）约 5 人日即可拿到主要收益。

---

## 18. 风险与开放问题

1. **单实例假设**：本 spec 依赖“同一 SQLite 只有一个可写进程”。桌面双开/CLI 并存的现状是否允许？若不允许，D5.3 的实例断言要默认开启（拒绝启动）。
2. **`DatabaseSync` 阻塞**：1s 轮询 + claim 是短事务；若未来 execution 数量上千，需要评估索引与批量 claim 的读放大。
3. **双轨期复杂度**：`both` 模式要求 worker 与文件 watcher 同时容忍重复触发（CAS 已保证），但监控上会出现“同一版本被消费两次”的正常日志，需要标注。
4. **`next_run_at` 双写**：S0 必须保证两者一致；若遗漏，投影会显示错误时间。建议加一条启动一致性检查。
5. **进度检查点的写入频率**：每个工具一次，长步骤（几十个工具）会产生几十行；需要按 attempt 删除/归档策略。
6. **`recovery_required` 的语义**：本 spec 不改变它，但 D6 之后“存储错误”不再进入该状态，需要更新相关文案与支持文档。

---

## 附录 A：pi-durable 对照（本 spec 借鉴点）

| 机制 | pi-durable 做法 | 本文落点 |
| --- | --- | --- |
| 调度真相 | 任务即数据库行，`open()` 把 running 改回 pending，`resume()` 起调度器 | D1–D3 |
| 错误分级 | 存储错误 fail-stop；请求错误单次；用户代码单单元（README Errors） | D6 |
| 租约 | 所有权树 + 心跳 + `abandonOnRestart` | D5 |
| CAS 与提交 | 所有任务转换由一条串行化提交线决定 | D2/D6（`retryOnConflict` + 事务内入队） |
| 进度提交 | 流式/工具输出 100ms 节流提交 | D7（工具边界检查点） |
| 取消 | 自底向上、`completing` 等 owned work、background 边界 | D8 |
| 观察 | `viewState()`/`watch()` 快照降级；`inspect()`/`taskGraph()` | D9（inspect；SSE 保持现方案） |
| 存储 | WAL + `synchronous=NORMAL`、storage 接口、conformance/benchmark | D10 |
| 定义迁移 | task/doc `version` + `migrate()` | D10.3 `engine_version` |

## 附录 B：关键行号索引（2026-10-17）

- `store.ts:636` 构造/打开；`store.ts:640` PRAGMA；`store.ts:1110` `getDetail`；`store.ts:1565` `transitionStatus`；`store.ts:1639` `claimAttempt`；`store.ts:1694` `heartbeat`（无调用者）；`store.ts:1714` `deferQueued`；`store.ts:1732` `finishAttempt`；`store.ts:1800` `reconcileOrphanedAttempts`；`store.ts:2409+` schema。
- `runtime.ts:191` lease 时长；`runtime.ts:213` `ensureQueuedEvents`；`runtime.ts:281` `run(event, filename)`；`runtime.ts:486` control 轮询；`runtime.ts:722` catch；`runtime.ts:749` `prepareRecovery`。
- `coordinator.ts:236` `ensureQueuedEvents`；`coordinator.ts:297` `reconcile`。
- `durable/events.ts:56` 文件入队；`agent/events.ts:327` `knownFiles`、`events.ts:419` watcher、`events.ts:426` 1s tick。
- `eventsLeaseStore.ts:22` `PROCESS_OWNER_ID`、`eventsLeaseStore.ts:149` `settingsDbFile`。
- `app/runtime.ts:744-758` runtime 装配与启动 reconcile。

## 附录 C：代码草图（供实现者照抄，非最终代码）

### C.1 `durable/store/wakeups.ts`

```ts
import type { DatabaseSync } from "node:sqlite";

export type WakeupReason = "advance" | "verify" | "capacity" | "resume" | "control" | "retry";
export type WakeupStatus = "pending" | "claimed" | "done" | "discarded" | "failed";
export interface WakeupRow {
  id: string; execution_id: string; expected_version: number; reason: WakeupReason;
  run_at: string; status: WakeupStatus; attempts: number; max_attempts: number;
  claimed_by: string | null; claimed_at: string | null; last_error: string | null;
  created_at: string; updated_at: string;
}

/** 同事务内调用：调用方已经 BEGIN IMMEDIATE。 */
export function enqueueWakeup(db: DatabaseSync, input: {
  executionId: string; expectedVersion: number; reason: WakeupReason; runAt?: Date;
}, now = new Date()): void {
  const ts = now.toISOString();
  db.prepare(`
    INSERT INTO durable_wakeups
      (id, execution_id, expected_version, reason, run_at, status, attempts, max_attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, 5, ?, ?)
    ON CONFLICT(execution_id, expected_version) DO NOTHING
  `).run(`wakeup-${crypto.randomUUID()}`, input.executionId, input.expectedVersion,
         input.reason, (input.runAt ?? now).toISOString(), ts, ts);
  // 新版本推进后，旧版本的 pending 行不再需要。
  db.prepare(`
    UPDATE durable_wakeups SET status = 'discarded', updated_at = ?
    WHERE execution_id = ? AND expected_version <> ? AND status = 'pending'
  `).run(ts, input.executionId, input.expectedVersion);
}

export function claimDueWakeups(db: DatabaseSync, ownerId: string, limit: number, now = new Date()): WakeupRow[] {
  const ts = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(`
      SELECT * FROM durable_wakeups
      WHERE status = 'pending' AND run_at <= ?
      ORDER BY run_at ASC, created_at ASC LIMIT ?
    `).all(ts, limit) as unknown as WakeupRow[];
    const claimed: WakeupRow[] = [];
    for (const row of rows) {
      const res = db.prepare(`
        UPDATE durable_wakeups
        SET status='claimed', claimed_by=?, claimed_at=?, attempts=attempts+1, updated_at=?
        WHERE id=? AND status='pending'
      `).run(ownerId, ts, ts, row.id);
      if (Number(res.changes ?? 0) > 0) claimed.push({ ...row, status: "claimed", claimed_by: ownerId });
    }
    db.exec("COMMIT");
    return claimed;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function settleWakeup(db: DatabaseSync, id: string, outcome: {
  status: "done" | "discarded" | "failed";
  error?: string;
}, now = new Date()): void {
  db.prepare(`UPDATE durable_wakeups SET status=?, last_error=?, updated_at=? WHERE id=?`)
    .run(outcome.status, outcome.error ?? null, now.toISOString(), id);
}

/** 可重试失败：退避回 pending。 */
export function backoffWakeup(db: DatabaseSync, row: WakeupRow, error: string, now = new Date()): void {
  if (row.attempts >= row.max_attempts) { settleWakeup(db, row.id, { status: "failed", error }, now); return; }
  const delay = Math.min(30_000 * 2 ** (row.attempts - 1), 30 * 60_000);
  const jitter = 0.8 + Math.random() * 0.4;
  db.prepare(`UPDATE durable_wakeups SET status='pending', run_at=?, last_error=?, updated_at=? WHERE id=?`)
    .run(new Date(now.getTime() + delay * jitter).toISOString(), error, now.toISOString(), row.id);
}

/** 进程重启：claimed 且超过 lease 的行回到 pending。 */
export function recoverStaleClaims(db: DatabaseSync, leaseMs: number, now = new Date()): number {
  const cutoff = new Date(now.getTime() - leaseMs).toISOString();
  const res = db.prepare(`
    UPDATE durable_wakeups SET status='pending', claimed_by=NULL, claimed_at=NULL, updated_at=?
    WHERE status='claimed' AND (claimed_at IS NULL OR claimed_at <= ?)
  `).run(now.toISOString(), cutoff);
  return Number(res.changes ?? 0);
}

/** 保留策略：done/discarded 保留 7 天。 */
export function pruneWakeups(db: DatabaseSync, days = 7, now = new Date()): number {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const res = db.prepare(`
    DELETE FROM durable_wakeups WHERE status IN ('done','discarded') AND updated_at <= ?
  `).run(cutoff);
  return Number(res.changes ?? 0);
}
```

### C.2 `durable/wakeupWorker.ts`

```ts
export class DurableWakeupWorker {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private inflight = new Set<Promise<void>>();

  constructor(private readonly deps: {
    store: DurableExecutionRuntime;        // 暴露 claimDueWakeups/runWakeup
    notify: () => Promise<void>;           // store.subscribe 触发
    intervalMs?: number;
    batch?: number;
  }) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? 1000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.inflight]);
  }

  /** 由 store.notify 调用：不等待，避免阻塞提交。 */
  kick(): void { void this.tick(); }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      for (;;) {
        const rows = this.deps.store.claimDueWakeups(this.deps.batch ?? 4);
        if (rows.length === 0) return;
        for (const row of rows) {
          const p = this.deps.store.runWakeup(row).finally(() => this.inflight.delete(p));
          this.inflight.add(p);
        }
        await Promise.allSettled([...this.inflight]);
        if (this.stopping) return;
      }
    } finally { this.running = false; }
  }
}
```

`runtime.runWakeup(row)` 的职责：

1. 读 execution；版本不符或已终态 → `settleWakeup(done|discarded)`；
2. 调现有 `run()` 的执行体（把 `event`/`filename` 换成 `row`）；
3. 业务失败 → `done`（状态已由 runtime 写）；进程级失败 → `backoffWakeup`；
4. 存储错误 → 交给 fatal 路径，不再写 wakeup。

### C.3 `scripts/migrate-durable-events.ts`（启动时调用，也可单独跑）

```ts
import { readdirSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

export function migrateDurableEventFiles(deps: {
  eventsDir: string; store: DurableExecutionStore; log: (...args: unknown[]) => void;
}): { scanned: number; enqueued: number; stale: number; discarded: number; failed: number } {
  const result = { scanned: 0, enqueued: 0, stale: 0, discarded: 0, failed: 0 };
  if (!existsSync(deps.eventsDir)) return result;

  for (const name of readdirSync(deps.eventsDir)) {
    if (!/^durable-execution-.+-v\d+\.json$/.test(name)) continue;
    const full = join(deps.eventsDir, name);
    result.scanned++;
    try {
      const event = JSON.parse(readFileSync(full, "utf8")) as {
        internal?: { durable?: { executionId?: string; expectedVersion?: number } };
      };
      const id = event.internal?.durable?.executionId;
      const version = event.internal?.durable?.expectedVersion;
      if (!id || !Number.isFinite(version)) { deps.discarded++; unlinkSync(full); continue; }

      const current = deps.store.getById(id);
      if (!current) { result.discarded++; unlinkSync(full); continue; }
      if (current.version !== version) { result.stale++; unlinkSync(full); continue; }
      if (!["planned", "queued", "verifying", "recovery_required"].includes(current.status)) {
        result.discarded++; unlinkSync(full); continue;
      }

      deps.store.enqueueWakeup({ executionId: id, expectedVersion: version, reason: "advance" });
      result.enqueued++;
      unlinkSync(full);
    } catch (error) {
      result.failed++;
      deps.log("durable_wakeup_migration_file_failed", name, String(error));
    }
  }
  deps.log("durable_wakeup_migration", result);
  return result;
}
```

启动接线（`app/runtime.ts`，替换现有 `ensureQueuedEvents` 那一行）：

```ts
const mode = process.env.MOLIBOT_DURABLE_WAKEUPS ?? "both";
if (mode !== "db") migrateDurableEventFiles({ eventsDir: durableExecutionEventsDir(), store, log: momLog });
if (mode !== "file") wakeupWorker.start();
durableExecutionRuntime.reconcile();      // 现在按 lease 过期判定
```

