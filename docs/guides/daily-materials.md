# 每日素材（daily-materials）运行原理与使用指南

> 面向：以后回查“这功能到底怎么跑的、用哪个模型、怎么配、能不能改便宜点”的自己。
> 相关代码均标注 `文件:行`，随版本可能漂移，改动前先 grep 确认。

---

## 1. 它是什么

每日素材是一个**内置定时任务（internal event）**：每天定时用只读投影扫描你**已授权的会话**，按可编辑的提示词模板提取「今日素材」，写入你注册的 Project（如 momo-agent）的 `content/daily-materials/YYYY-MM-DD.md`。

- 它**不走普通聊天 Runner**，也**不用 Subagent**（下面第 4 节详解）。
- 内容 Project（小红书那套）只消费这些素材文件，永不直接读 session。
- 配套还有一个**一次性历史回填**：把项目已经跑了几周/几个月的历史，一天一个文件补齐。

## 2. 两条运行入口

### 2.1 每日定时（periodic）
1. 你在 Desktop「设置 → 插件 → 记忆 → 每日素材」里启用、选输出 Project、设时间（默认 23:30）、选提示词模板路径。
2. 保存后 `runtime.updateSettings` 会触发 `taskScheduler.restart`，`ensureDailyMaterialsEvent`（`src/lib/server/agent/taskScheduler.ts:118`）在该 bot 的 `events/daily-materials.json` 写一个 periodic 托管 event，schedule 由 `time` 转成 cron。
3. `EventsWatcher`（`src/lib/server/agent/events.ts`）到点触发，因为 `execution: "internal"`，走 `dispatchTaskEvent` → `runInternalEvent`（`src/lib/server/app/runtime.ts:216`）→ `DailyMaterialsService.run`。
4. `run` 只处理**上一个完整本地日**（`previousReflectionLocalDate`），即“昨天”。

### 2.2 一次性历史回填（backfill）
1. Desktop「记忆 → 每日素材」下的「回填历史」按钮（只有在已保存配置里**已启用且已选 Project**时才出现）。
2. 点按钮 → `POST /api/desktop/plugins/daily-materials-backfill {action:"start"}`（`src/routes/api/desktop/plugins/daily-materials-backfill/+server.ts`）。
3. 服务端用 `collectDailyMaterialsBackfillInternals`（`src/lib/server/agent/taskScheduler.ts`）按当前设置枚举所有渠道/bot 的 daily-materials 扫描目标，交给内存后台任务 `DailyMaterialsBackfillJob`（`src/lib/server/app/dailyMaterialsBackfill.ts`）。
4. 任务对每个目标调用 `DailyMaterialsService.runBackfill`：起始日期默认由 `SessionReflectionSourceReader.earliestLocalDate` 自动扫出最早一条授权消息，终点是“昨天”，**按日期升序逐天**调用 `runForDate`。
5. 前端每 1.5s 轮询 `GET .../daily-materials-backfill` 显示进度（已处理 X/Y、覆盖天数）。

> 回填与定时**共用同一套 `runForDate`**，唯一区别是回填在一个日期区间上循环。

## 3. 单日处理流程（`runForDate`，`src/lib/server/memory/dailyMaterials.ts`）

1. 用 `dailyMaterialsTargetId`（带 `"daily-materials"` 前缀的哈希）算出**独立 watermark 通道**（与记忆反思隔离，见第 5 节）。
2. `reader.read(target, localDate)` 拿只读投影：过滤到当天、且 `> watermark` 的新增消息。**投影为空就直接返回、不写文件、不调模型**（幂等重跑会安静跳过）。
3. 解析输出 Project（`getProjectStore().get(projectId)`，不存在则抛错、不降级）；对 `dir` / `promptPath` 做 realpath containment 校验（拒绝绝对路径与 `..`、拒绝软链逃逸）。
4. 读提示词模板（`promptPath`，相对 Project root）；不存在用内置兜底模板并标注。
5. **按 token 预算分批**（见第 4 节）：把各会话打包成一批或多批。
6. **调用模型**（下节）：单批 → 一次调用直接出正文；多批 → 每批各调一次提取，再一次「汇总」调用合并去重成当日文件。命中疑似凭据正则（`sk-…`/`AKIA…`/`password:` 等）直接抛错，宁可失败不外泄。
7. 写 `<dir>/<localDate>.md`：不存在则新建；已存在则追加 `## 补充（HH:mm 生成）`。
8. **写成功后**才逐会话 `state.set` 推进 watermark。abort / 失败都不推进。

## 3.5 扫描规模、token 预算与内容过滤（常见疑问）

**会扫描全部会话吗？** 会。读取层 `SessionReflectionSourceReader.read` 遍历该 bot 授权范围内**所有**会话，取当天且 watermark 之后的全部新增消息。读的时候不漏 session。

**思考过程 / 工具调用会被移掉吗？** 已经天然排除，靠的是存储结构而非正则清洗：
- session 里 `message.content` 只存**最终正文**；`thinking`（思考）、`toolCall`/`toolResult`（工具调用）在**独立的 part / 独立 role / `activities` 数组**里，不进 `content`。
- 扫描的 `projectionText` 只读 `role: content`（user/assistant 两种角色）。
- 所以送进模型的是干净的“人说了什么、助手答了什么”，没有工具噪音和思考链；模板还额外让模型跳过寒暄与纯技术往返。

**预算与分批（取代旧的写死 6 万字符截断）：**
- 预算按 **token 估算**，CJK-aware（CJK 字 ≈ 1 token，其他 ≈ ¼；`estimateTokens`）。可在设置里改：`dailyMaterials.scanTokenBudget`，默认 **120000**，范围 8000–900000。
- **混合策略**（`planBatches` + `runForDate`）：
  - 当天总量 ≤ 预算 → **一次调用**，全量进模型。
  - 超预算 → 按会话贪心打包成多批，**每批各提取一次**，最后**一次汇总调用**合并去重成当日文件。**不再整段丢弃较早会话**。
  - 个别单个会话本身就超预算 → 只对它保留最新片段（tail 截断）并标注，其余会话不受影响。
- 结果里 `batches` / `truncatedConversations` 记录了当天分了几批、多少个会话被截断，便于排查。

> 提醒：预算越大、会话越多 → 单日 token 消耗越大；多批还会多几次调用。回填历史时这个乘数会叠加，注意额度。

## 4. 用哪个模型？（重点）

**结论：可以单独指定「扫描模型」。默认跟随主模型；在 Desktop「记忆 → 每日素材 → 扫描模型」里选一个更小更便宜的即可。不涉及 Subagent。**

- 配置项：`dailyMaterials.scanModelKey`，模型键格式 `pi|provider|model` 或 `custom|id|model`（与 `modelRouting` / `buildModelOptions` 一致）。**留空 = 跟随聊天主模型。**
- 生效路径：runtime 构造 `DailyMaterialsService` 的 `reply` 回调时带上 `{ modelKey: settings.plugins.memory.dailyMaterials.scanModelKey }`；`AssistantService.reply` 的 `overrideSettingsForModelKey`（`src/lib/server/providers/assistantService.ts`）据此临时把 `providerMode` / `piModelProvider|piModelName`（或 custom provider 的 `defaultModel`）切成该模型，仅对这一次调用生效，不改全局设置。
- **每日定时任务与历史回填都走这个回调**，所以都用扫描模型。**多批+汇总的每一次调用**也用它。
- **没有 Subagent**：每次就是一次普通 completion，不派生子智能体、不递归、无工具调用。
- 主模型选择（未设扫描模型时的回落）：pi 模式用 `settings.piModelName`（Desktop 模型选择器切换，见 `modelSwitch.ts`），custom 模式用默认 custom provider 的 `defaultModel`。

> 便宜模型够吗？素材提取是“读对话、按模板输出要点”，对推理要求不高，小模型通常够用；但**脱敏判断**（哪些不可公开）质量会下降，建议先小范围回填几天对比效果再全量。

## 5. Watermark / 幂等 / 隔离

- 每会话一个 watermark（`ReflectionStateStore`，与记忆反思共用同一 sqlite 表，但 **targetId 不同**）。
- **隔离**：素材用 `dailyMaterialsTargetId`（`"daily-materials"` 前缀），反思用 `reflectionTargetId`，天然不冲突。为此 `SessionReflectionSourceReader` 构造时注入了 `targetIdOf`（`src/lib/server/memory/reflection.ts`），素材的 reader 用素材的 targetId 查 watermark——否则会串台污染反思进度（历史踩过的坑）。
- **幂等/可续跑**：回填升序逐天推进 watermark，中断（重启/超时/报错）后再点一次「回填历史」，已覆盖的日期自动跳过、从断点续跑。
- 回填有硬上限 `MAX_BACKFILL_DAYS = 800`，防坏时钟/坏时区把任务撑爆。

## 6. 配置与使用步骤（给非编程用户）

1. Desktop → 设置 → 插件 → 记忆 → 每日素材：**启用**、选**输出 Project**（momo-agent）、设**时间**、（可选）改 `dir` / 提示词模板路径 / 通知开关 → **保存**。
2. 保存即生效：调度器重建托管 event，之后每天到点自动生成“昨天”的素材文件。
3. 首次想补历史：点「回填历史」，等进度跑完（覆盖 N 天）。⚠️ 回填是**逐天真实调用模型**，两个月数据消耗额度不小，只需跑这一次。
4. 产物在 `<输出Project>/content/daily-materials/YYYY-MM-DD.md`；开了通知则完成后推给首个允许的 chat。

## 7. 关键代码地图

| 关注点 | 位置 |
| --- | --- |
| 单日/回填核心逻辑 | `src/lib/server/memory/dailyMaterials.ts`（`run` / `runForDate` / `runBackfill`） |
| 最早日期扫描 | `src/lib/server/memory/reflection.ts` `SessionReflectionSourceReader.earliestLocalDate` |
| 托管 event + 回填目标枚举 | `src/lib/server/agent/taskScheduler.ts`（`ensureDailyMaterialsEvent` / `collectDailyMaterialsBackfillInternals`） |
| internal 事件分发 + reply 回调 | `src/lib/server/app/runtime.ts:216`（`runInternalEvent`） |
| 模型选择（主模型，无路由） | `src/lib/server/providers/assistantService.ts:283`（`reply` → `callPiMono` / `callCustomProvider`） |
| 回填后台任务 | `src/lib/server/app/dailyMaterialsBackfill.ts` |
| 回填 API | `src/routes/api/desktop/plugins/daily-materials-backfill/+server.ts` |
| Desktop UI（含回填按钮） | `apps/desktop/src/lib/settings/PluginsSection.svelte` |
