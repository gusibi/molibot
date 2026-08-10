# Permission Modes PRD — 会话级权限模式（Plan / Manual / Accept edits / Auto）

> Session-scoped permission modes that govern **whether to ask the user**, decoupled from the sandbox, which governs **what a call can touch**.
>
> - **Status**: Proposed (2026-08-09). Not started.
> - **PRD index entry**: `prd.md` §3.64 (2026-08-09)
> - **Revision**: v1 (2026-08-09) — initial version from product-owner discussion. Two decisions fixed by the product owner up front: **Bypass 不做**（不提供无条件放行档），**默认档为 Accept edits**。
> - **Implementer note**: read CLAUDE.md "Recurring Pitfalls" before starting — #2（Svelte 5 reactivity，per-session 选择被全局刷新重置是同一个 bug 家族）、#7（共享模块不许 fork）、#11（settings round-trip）、#14a（guard 让 turn 收尾，不是杀掉它）、#15（沙箱 fail closed）、#16c（pill 不能加 container-type）、#21d（第三方代码的进程故障域）、#23（automation lease 不能被卡住）、#32（通道交互回执的两阶段投递）全部直接命中这个改动面。

---

## Problem Statement

今天 Molibot 有三套互不知情的闸门：

| 机制 | 位置 | 实际作用范围 |
|---|---|---|
| `toolSandbox.enabled` | `src/lib/server/agent/tools/sandbox.ts:478`（session → project → bot 实例 → agent → 全局，五级 override） | **只包住 `bash`** |
| ApprovalBroker / `decidePolicy` | `src/lib/server/agent/tools/index.ts:290` | 只拦 `risk === "high" \|\| "critical"`，实际只有 `extensionManage` / `miniAppManage` 走到 |
| HostBash 审批 | `src/lib/server/hostBash/` 自带 store、scope、owner | 仅 bash 逃出沙箱到宿主时的独立审批链 |

由此产生四个具体问题：

1. **只有两档，且这两档是同一个 boolean。** `bashPolicy.ts:62` 的 `if (!sandboxEnabled) return { type: "allow" }` 把「跑在哪个盒子里」和「要不要问用户」压成了一件事。今天实际只有「沙箱开」和「沙箱关」，大致对应业界的 Auto 和 Bypass，中间三档没有任何落脚点。

2. **`write` / `edit` 没有任何闸门。** 它们的 risk 是 `medium`（`toolClassification.ts:50`），而 `decidePolicy` 只拦 high/critical，所以文件写入永远直接放行，用户无从选择「写文件也要先问我」。

3. **沙箱的 filesystem 策略对文件工具完全无效。** `write` / `edit` 走的是 `createPathGuard(cwd, workspaceDir)`（`tools/index.ts:322`），与 `toolSandbox.filesystem.denyWrite / allowWrite` 是两套不相干的东西。用户在 Sandbox 设置里配了 `denyWrite`，`write` 工具照写不误。**这是当前就存在的语义漏洞**，只是因为 write 从不需要审批所以没被触发。

4. **缺一个只读的规划态。** 用户无法要求「先给我方案，别动我的文件」，只能靠 prompt 约束，而 prompt 约束对弱模型不成立。

结构性缺口在于：`getRuntimeToolClassification` 只产出 `{ risk, source }`。`write`(medium) 与 `webSearch`(medium) 同级、`bash`(high) 与 `miniapp__x.delete`(high) 同级 —— **用 risk 这一个维度无法表达「写文件放行、执行命令仍要问」**，因为这两类在 risk 轴上不可分。这是整个功能的地基缺口。

---

## Solution

引入 **会话级权限模式（Permission Mode）**，作为与沙箱正交的第二根轴：

- **Sandbox 轴**（已有）：这次调用的副作用被围在哪里 —— `sandboxed` 还是 `host`。
- **Mode 轴**（新增）：在给定的围栏级别下，这个副作用要不要先问用户。

四档，严格单调放宽，**不提供 Bypass**：

`Plan` ⊂ `Manual` ⊂ `Accept edits`（默认） ⊂ `Auto`

### 决策矩阵

唯一闸门是一个纯函数 `decidePermission(mode, effect, containment, scopeState) → allow | ask | deny`：

| effect × containment | Plan | Manual | **Accept edits（默认）** | Auto |
|---|---|---|---|---|
| read（`read` / `ls` / `grep` / `webSearch`） | allow | allow | allow | allow |
| write / edit，**在允许写的根内** | deny | ask | **allow** | allow |
| write / edit，允许写的根外 | deny | ask | ask | ask |
| bash，**沙箱内** | deny | ask | allow | allow |
| bash，宿主（逃逸，未授权） | deny | ask | ask | ask |
| bash，宿主（已有 owner-scoped grant） | deny | ask | allow | allow |
| network（`webFetch` / MCP 网络调用） | deny | ask | allow | allow |
| third_party 只读（`readOnlyHint` 明确声明） | deny | ask | ask | **allow** |
| third_party 未声明（无 annotation） | deny | ask | ask | ask |
| third_party 破坏性（`destructiveHint`） | deny | ask | ask | ask |
| manage（`extensionManage` / `miniAppManage` 的 validate/install） | deny | ask | ask | **ask** |

三条不可被模式放宽的硬规则：

- **`manage` 在任何模式下都要问。** 它下载并执行第三方代码，"安装这个插件"可能来自 Agent 读到的内容而非机主。这条对应 pitfall #21(d) 的进程故障域立场，Auto 也不例外。
- **`deny` 只出现在 Plan。** 其余模式里"不允许"一律表达为 `ask`，用户永远有放行的出口。
- **沙箱不可用时不降级。** `prepareToolSandboxExecution` 的 fail-closed 行为不变（pitfall #15）；沙箱起不来 = 这次调用被归入 `host` containment，由 mode 决定 ask 还是 deny，绝不因此变成 allow。

### 为什么不需要 Bypass

Bypass 在业界产品里的存在理由是"我信任这个仓库，别再打断我"。在 Molibot 里这个需求由两个已有机制承接，且比 Bypass 更安全：

1. **Auto + owner-scoped grant**：审批卡上的"一直允许"落成 `ApprovalScope: persistent` 的 grant，带 bot/project owner（HostBash 已经做对了这件事，见 `hostBash/types.ts` 的 owner 注释）。用户对**具体命令**授权，而不是对**整个会话**放弃闸门。
2. **沙箱轴**：真正想放开执行环境的用户关掉沙箱即可，但**关沙箱不再等于免审批** —— 这正是两轴解耦的直接结果。

**这是一次有意的收紧**：今天「关沙箱 + 直接跑」的用户，改动后会在首次执行宿主命令时被问一次，然后可以授予 persistent grant。迁移影响见下方 §迁移。

### Auto 与 Accept edits 的区别是一件具体的事

两档只差一行：**第三方工具（MCP / Mini App）的非破坏性调用是否需要确认。** Accept edits 要问，Auto 不问。这样两档都有明确的存在理由，不会退化成"感觉上更松一点"。

---

## 需要的架构调整

### 1. 给工具分类加 effect 维度（地基）

`getRuntimeToolClassification` 从 `{ risk, source }` 扩为 `{ risk, source, effect }`：

```
effect: "read" | "write" | "execute" | "network" | "third_party" | "manage"
```

- Mini App：从 manifest 的 `readOnlyHint` / `destructiveHint` 映射，**不从工具名猜**（现有注释已经写明这条）。
- MCP：默认 `third_party`；若 server 声明了 MCP 标准的 `readOnlyHint` / `destructiveHint` annotation 则采用，**缺失时按"非破坏性但需确认"处理，不按只读处理**。`destructiveHint` 优先于 `readOnlyHint`；`readOnlyHint` 的放宽只在 Auto 档生效（2026-08-10 定档，见已决问题 3）。
- pi 扩展工具：`third_party`。
- `risk` 保留不动，用于审批卡的展示分级与审计串，不再单独承担闸门职责。

### 2. `PermissionMode` 类型与解析链（共享层）

放 `src/lib/server/agent/permissions/`。override 优先级与沙箱完全同形：session → project → bot 实例 → agent → 全局默认。

**必须把 override 解析抽成一个通用的 session-scoped resolver，`resolveEffectiveSandboxSettings` 改为它的调用方**，而不是复制第二份五级链（pitfall #7）。存储位置与 sandbox override 同处（`session/store.ts:1127` 附近的 session preferences）。

新增设置字段要过 pitfall #11 的完整 round-trip：`sanitize` → `store` → **每一个手写投影**（settings 页面的 `loadAll()` 映射、保存序列化、desktop projection）都要带上，任一处漏掉就会在保存成功的瞬间清空控件。

### 3. `decidePolicy` 纯函数化

`tools/index.ts:290` 现在是闭包里的匿名函数，测不了。改为：

```
decidePermission(mode, effect, containment, scopeState) → PolicyDecision
```

`containment` 由调用点计算：bash 看沙箱是否实际生效 + 是否命中已批准的 HostBash grant；write/edit 看目标路径是否落在允许写的根内。

### 4. `bashPolicy` 两轴解耦（最小但最关键的一处）

`bashPolicy.ts:62` 的 `if (!options.sandboxEnabled) return { type: "allow" }` 必须改为：沙箱关 → containment 降为 `host` → 交给 `decidePermission`。不改这一行，Manual 模式一旦关沙箱就静默退化成 Bypass —— 而 Bypass 是本 PRD 明确不做的档。

### 5. `write` / `edit` 接入沙箱 filesystem 策略（切片 0，先修）

当前 `toolSandbox.filesystem.denyWrite / allowWrite` 对文件工具完全无效。一旦上了 Accept edits（自动放行文件写入），这个漏洞就从"配置不生效"升级成"自动批准了一批本该被沙箱拒绝的写入"。

Accept edits 的"允许写的根"必须**显式声明**为 project root + workspace + scratch，并叠加 `denyWrite` 黑名单，**不能靠 cwd 恰好落在里面推导**。注意 `buildEffectiveSandboxConfig` 目前把整个 `config.dataDir` 设为可写（`sandbox.ts:370-379`），这个范围对 bash 合理，对"自动放行"过宽。

### 6. 审批链收敛 —— 绝不能加第三套

Manual 模式会让 `write` / `edit` 也需要审批。`ApprovalService` 已经是 façade（`approvalService.ts:44` 的 `BrokerApprovalService`），**HostBash 收敛为它的一个 backend**，而不是并列的第二套 UI。

CLAUDE.md 已经记录过这条坑："统一审批卡的 list 与 resolve 必须覆盖同一组后端并按 Session 校验" —— 这次正是那个战场。同时要把审批卡的"一直允许"接到已有但从未被生成过的 `ApprovalScope`（`once | turn | session | workspace | persistent`），并给 broker 侧补上 HostBash 已有的 bot/project owner 概念。

### 7. Plan 模式：工具集收窄，不是调用后拒绝

Plan 是四档里最贵的一档，因为它不是"每次 deny"：

1. **工具集必须在暴露给模型之前收窄**，只保留 read-effect 工具 + 一个 `exitPlan` 工具。deny-after-call 会让弱模型反复撞墙耗光预算 —— 这正是 pitfall #14(a) 的教训："a guard winds a turn down; it does not kill it"。
2. **`exitPlan` 产出一张确认卡**（新的 `RunDetailEntry` 类型 + 复用 `ApprovalCard.svelte` 的形状），用户在卡上选择退出后进入哪一档（Accept edits / Manual），确认后**在同一 session 继续跑**，不新开会话。
3. **计划产物要落地**，不能只是 transcript 里的一段文本。落到 session workspace 的 Markdown 文件，便于 Artifact Panel 打开与后续 `@` 引用。
4. Plan 是 session-scoped，持续到用户显式退出，不是 turn-scoped。

### 8. 前端

- 仿 `ComposerModelMenu` 做 `ComposerModeMenu`，挂 `ChatInputArea.svelte:265` 的 `composer-selectors` slot。**不新建第二套下拉实现。**
- 快捷键循环四档。
- pitfall #2 推论：per-session mode **绝不能被全局设置刷新重置成默认** —— 这与 model 选择漂移是同一个 bug 家族，必须有结构守卫。
- pitfall #16(c)：mode pill 不能加 `container-type: inline-size`，否则文字静默消失。
- pitfall #4：只用语义 token，不写 `[data-theme="dark"]` 专用规则。

### 9. 非桌面通道与 automation

- **Plan 与 Manual 仅桌面**（2026-08-10 定档）：飞书/微信/Telegram 没有 ExitPlan 的交互载体，Manual 又会对每次文件写入发卡。通道侧的模式选择器只暴露 **Accept edits / Auto** 两档。
- 通道的 ask 走已有的通道审批卡链路，且必须遵守 pitfall #32 的两阶段投递契约：回调窗口内先返回无按钮的处理中卡，执行恰好一次，再按 `open_message_id` 更新为成功/失效/失败卡；更新失败则降级为文本回执。
- **Automation（`origin: "automation"` / `t-*` session）走挂起 + 异步恢复**（2026-08-10 定档，采用下方 (a)）：
  - (a) 复用 `bash.ts` 已有的 `waiting_for_approval` 状态 + 异步恢复路径，**并在同一步把 execution lease 记为 `interrupted`**，使挂起的任务不占用调度、也不会被 `hasActiveForTask` 判成 `task_already_running` 而抑制后续运行；
  - 用户批准后经既有异步恢复路径续跑；恢复失败写入执行记录并可见，不得静默丢弃。
  - **绝不允许 automation 因为审批而让 lease 停在 `running`**（pitfall #23）。

---

## 迁移

- `permissionMode` 在所有层级初始化为 unset → 落到全局默认 **Accept edits**。
- 现有的 `sandboxEnabled`（session / project / instance / agent / 全局）语义不变，继续表示沙箱轴。
- **行为变化**：今天关闭沙箱的会话/机器人，改动后首次执行宿主命令会被问一次；授予 persistent grant 后恢复无打扰。首次进入该状态时给一条一次性说明，指向 grant 的授予入口。
- **行为不变**：今天开启沙箱的会话，Accept edits 下沙箱内命令与文件写入仍然直接跑，与现状一致。

---

## 切片

| 切片 | 内容 | 依赖 |
|---|---|---|
| **0（前置）** | `bashPolicy` 两轴解耦；`write` / `edit` 接入 `toolSandbox.filesystem` 策略；显式声明"允许写的根" | 无 |
| **1** | effect 维度；`PermissionMode` 类型 + 通用 override resolver（沙箱改为其调用方）；`decidePermission` 纯函数；桌面 `ComposerModeMenu`；审批 scope/grant 落地（含 owner）；交付 **Manual / Accept edits / Auto** 三档，Plan 占位但 disabled | 切片 0 |
| **2** | **Plan 模式**：工具集收窄、`exitPlan` 确认卡、计划产物落地、退出后同 session 继续 | 切片 1 |
| **3** | 审批链收敛：HostBash 降为 `ApprovalService` 的 backend，统一卡片的 list/resolve 覆盖同一组后端并按 session 校验 | 切片 1 |

切片 1 明确禁止新增第三套审批 UI；HostBash 的收敛可以后置到切片 3，但切片 1 的新审批必须全部走 `ApprovalService`。

---

## 验收

### 机器守卫（每条都要有对应测试）

1. **决策矩阵全覆盖**：`decidePermission` 的 `4 模式 × 6 effect × containment` 全矩阵单测，逐格断言，包括"`manage` 在 Auto 下仍然 ask"和"沙箱不可用时不降级为 allow"。
2. **两轴解耦**：断言「沙箱关闭 + Manual」产生 `ask` 而非 `allow`（覆盖 `bashPolicy.ts:62` 的回归）。
3. **filesystem 策略生效**：断言 `denyWrite` 命中的路径在 Accept edits 下仍然被拒，且 `write` / `edit` 与 `bash` 对同一路径给出一致结论。
4. **Settings round-trip**：save → 全新 store → load，断言 `permissionMode` 在数据库、sanitize、以及**每一个手写投影**里都保留（pitfall #11）。
5. **Override 解析链单一实现**：断言 sandbox 与 mode 共用同一个 resolver，且五级优先级一致。
6. **Plan 是收窄不是拒绝**：断言 Plan 模式下 Provider 实际收到的 tool list **不包含** `write` / `edit` / `bash`，而不是断言 deny 的次数（pitfall #14a）。
7. **Automation 不卡 lease**：断言 automation session 的受限调用不会让 execution lease 停在 `running`（pitfall #23）。
8. **结构守卫（`apps/desktop/src/chat-ui.test.mjs`）**：mode pill 无 `container-type`；per-session mode 不被全局 settings 刷新重置；mode 菜单复用 `ComposerModelMenu` 的实现而非 fork。

### 手工验收（pitfall #10 冷启动走查）

重启服务后：首次打开会话即可看到当前模式；切换模式后切走再切回，模式保持；关闭沙箱 + Manual 下执行一条宿主命令，卡片出现、批准后命令真的执行、结果回到 transcript；Plan 模式下要求模型改文件，模型给出计划而不是报"工具被拒绝"；ExitPlan 确认后在同一会话继续并完成改动。

### 验证口径（pitfall #9）

桌面 UI 改动：`svelte-check` 0 errors / 0 warnings + `vite build` + desktop UI 测试。Agent / runtime 改动：agent 测试套件 + 触达文件的 `tsc`。结果写进 `CHANGELOG.md` 条目。

---

## 已决问题（产品负责人拍板，2026-08-10）

1. **Automation 的默认行为 → (a) 挂起 + 异步恢复。** 采用 §9 的 (a)，**不是**本 PRD v1 倾向的 (b)。理由是语义与人工会话一致：无人值守时一条未授权的宿主命令不该被静默判失败，它应该等一个人来看。

   代价必须由实现兜住，否则这一档就是 pitfall #23 的复发：**挂起时 lease 必须立即记为 `interrupted`，绝不允许停在 `running`。** 具体契约：

   - 受限调用发生时，复用 `bash.ts` 已有的 `waiting_for_approval` 路径；
   - 同一步把 execution lease 释放（`interrupted` + 原因），使 `hasActiveForTask` 不再把它算作占用，后续调度不被这条挂起任务堵死；
   - 用户批准后走既有异步恢复路径续跑，恢复失败必须写进执行记录并可见，不得静默丢弃；
   - 机器守卫（验收 §7）要断言的是"挂起后 lease 不在 `running`"且"该任务的下一次调度没有被 `task_already_running` 抑制"——两条一起才算覆盖，只断言前者会漏掉 pitfall #23(b) 那个家族。

2. **Manual 在通道上 → 不暴露。Manual 仅桌面端。** 与 Plan 相同处理：通道侧的模式选择器只暴露 **Accept edits / Auto**，Plan 与 Manual 都是桌面独有。这样通道上不需要为每次文件写入发卡，§210 提的批量确认也就不必做。

   注意这条把 §9 的第一行从"Plan 仅桌面"扩为"Plan 与 Manual 均仅桌面"，通道选择器因此只剩两档。

3. **MCP `readOnlyHint` → 允许放宽一次调用。** 第三方 server 声明的 `readOnlyHint` 可以让该调用在 Auto 档自动放行，即采用 §96 的乐观版本而非保守版本。

   边界要卡死，避免这条被读成"信任第三方自报"：
   - 只放宽到 **Auto** 一档。Accept edits 及以下仍然 ask，Plan 仍然 deny；
   - `destructiveHint` **永远优先于** `readOnlyHint`；两者同时声明按破坏性处理；
   - **缺失即非只读**：未声明任何 annotation 的调用仍按"非破坏性但需确认"处理，不因缺省而放行；
   - 放宽的是 mode 轴，不是沙箱轴——`readOnlyHint` 不改变这次调用被围在哪里。

---

## 未决问题

（暂无。上述三项已于 2026-08-10 定档。）

---

## Out of Scope

- **Bypass 档**（产品决策，2026-08-09）：不提供无条件放行。等价能力由 Auto + owner-scoped persistent grant 承接。
- 逐工具的细粒度开关（"允许 `git`，禁止 `npm`"）：这是 grant 的职责，不是 mode 的职责。
- 模式的自动切换/学习（按仓库、按历史行为自动选档）。
- Plan 模式的多方案对比与投票。
