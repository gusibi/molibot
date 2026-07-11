# Handoff：daily-materials 内置任务（每日素材 → momo-agent project）

> 状态：调研完成、方案已收敛、待实现。本文件是跨 session 执行底稿，所有 file:line 已核实（2026-07-11）。
> 背景讨论见 grabby 仓库那个 session；产品背景：`docs/market/定位.md`（魔魔计划）+ `docs/requirements/memory-improvement-plan.md`（C0.5 反思运行契约）。

## 1. 目标

新增一种内置（internal）定时任务 `daily-materials`：每天定时用只读投影扫描授权会话（复用反思的 ReflectionSourceReader），按用户可编辑的提示词模板提取「今日素材」，写入注册 Project（momo-agent）的 `content/daily-materials/YYYY-MM-DD.md`。小红书内容 project 只消费该文件与记忆检索，永不直接读 session。

完成标准：**用户在 Desktop 配置好后，从自动化任务页手动触发一次，momo-agent 里出现当日素材文件。**

## 2. 设计决定（已与 owner 确认，不要重新讨论）

- 载体：periodic watched-event JSON + `execution: "internal"`，与 memory-reflection 同一套调度/lease/watermark 机制。**不走普通聊天 Runner**（原因见 memory-improvement-plan C0.5：会话污染、过程外泄、权限收不住）。
- 输出位置：`internal.output = { projectId, dir }`，projectId 引用已注册 Project（`getProjectStore().get(id).rootPath`），dir 默认 `content/daily-materials`。**不用绝对路径**；project 无效/断开时本次 run 失败、watermark 不推进，**不得降级写到 scratch**。
- 内容/风格控制：`internal.promptPath`（相对 project root 解析），指向 momo-agent 里的提取指令模板。编辑模板即调整输出，不改代码。
- 记忆候选抽取（memory-reflection）保持封闭 schema **不开放提示词**；只有素材链路是提示词可配的（输出是给人看的自由格式文件，无治理负担）。
- 素材任务与反思任务扫同样的 sourceScopes，但 watermark 独立（targetId 哈希加 kind 前缀），推进节奏互不影响。
- 防重/发布记录按 owner 决定走 momo-agent 的文件（content/published/），不强制接记忆检索。

## 3. molipibot 实现清单

### 3.1 event schema — `src/lib/server/agent/events.ts:22`

现状：`internal?: { kind: "memory-reflection"; notificationChatId?; target: {...} }`（单一 kind 内联类型）。

改为（保持向后兼容）：

```ts
export type InternalEventKind = "memory-reflection" | "daily-materials";

export interface InternalEventTarget {
  ownerId: string;
  botId: string;
  timezone: string;
  sourceScopes: Array<{ channel: string; externalUserId: string; projectId?: string; shareOwner?: boolean }>;
}

// EventBase 内：
internal?: {
  kind: InternalEventKind;
  notificationChatId?: string;
  target: InternalEventTarget;
  promptPath?: string;                      // daily-materials：相对 output project root
  output?: { projectId: string; dir?: string }; // daily-materials：默认 dir = "content/daily-materials"
};
```

### 3.2 新服务 — 新建 `src/lib/server/memory/dailyMaterials.ts`

参考 `src/lib/server/memory/reflection.ts`（已实现的 MemoryReflectionService，模式完全一致）：

- 构造依赖：`SessionReflectionSourceReader`（reflection.ts:107，直接复用实例）、`ReflectionStateStore`（reflection.ts:52，复用同一 sqlite；**targetId 用 `sha256(JSON.stringify(["daily-materials", ownerId, botId, timezone, canonicalScopes]))`**，与 reflectionTargetId（reflection.ts:84）天然隔离）、一个 `reply(prompt: string) => Promise<string>` 回调（runtime 里用 assistant.reply 包一层，见 runtime.ts:167 的现有用法）、`getProjectStore`（`src/lib/server/projects/store.ts:236`）。
- `run(event.internal, options)`：
  1. `localDate = previousReflectionLocalDate(now, timezone)`（reflection.ts:97，处理上一个完整本地日，与反思一致）；
  2. `reader.read(target, localDate)` 拿投影（注意：reader.read 内部用 reflectionTargetId 查 watermark——所以**不能直接复用 reader**，需要给 SessionReflectionSourceReader 加可选 targetId 参数，或本服务自建一个 reader 实例传入自定义 state 查询。最小改动：给 SessionReflectionSourceReader 构造器加可选 `targetIdOf?: (target) => string`，默认 reflectionTargetId）；
  3. 投影为空 → 返回 `{ createdFile: null, scannedMessages: 0 }`，不写文件（幂等重跑安静跳过）；
  4. 解析 project：`getProjectStore().get(output.projectId)`，不存在则 throw；`dir = output.dir || "content/daily-materials"`；`resolve(rootPath, dir)` 后做 containment 校验（参照 `src/lib/server/projects/inspection.ts` 的 realpath 手法，或 path.resolve + startsWith rootPath + sep）；
  5. 读模板：`resolve(rootPath, promptPath)`（同样 containment 校验；不存在时用内置兜底模板，并在结果里标注）；
  6. 拼 prompt：模板 + 每个投影的 `channel/sessionId + role: content` transcript + latestSummary（如有）。**设 token/字节预算**：transcript 总量截断到 ~60k 字符，超出时保留最新消息并在 prompt 里注明已截断；
  7. `reply(prompt)` 得到 markdown 正文；做一次代码侧安全兜底：输出中命中 `/(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|password\s*[:=])/i` 之类的疑似凭据模式时 throw（宁可失败）；
  8. 写文件 `<dir>/<localDate>.md`：不存在则写入；已存在则追加 `\n\n---\n\n## 补充（HH:mm 生成）\n\n` + 正文（部分会话昨天已扫、今天补扫新增量的场景）；
  9. **写成功后**逐 conversation `state.set(targetId, conversationId, watermark, runKey)`（runKey = `${targetId}:${localDate}`）；
  10. 返回 `{ createdFile: "<dir>/<localDate>.md"（相对 project root）, scannedConversations, scannedMessages }`。
- abort 语义与 MemoryReflectionService.run（reflection.ts:175）一致：signal.aborted 时 throw，且不推进 watermark。

### 3.3 runtime 接线 — `src/lib/server/app/runtime.ts:202`

现状：

```ts
const taskScheduler = new TaskScheduler(async (event, filename) => {
  if (event.internal?.kind !== "memory-reflection") throw new Error("Unsupported internal event.");
  const result = await reflectionService.run(...); ...
});
```

改为：抽出 `runInternalEvent` 具名函数，按 kind 分发：memory-reflection 走现有逻辑；daily-materials 构造/调用 `DailyMaterialsService`，成功且有产出时返回 `{ notificationText: `今日素材已生成：${createdFile}` }`（零素材时返回 undefined 不通知）。并把 `runInternalEvent` 存进 RuntimeState（runtime.ts:24 的接口加字段），供 3.5 的手动触发使用。DailyMaterialsService 的 reply 回调：`(prompt) => assistant.reply([{ id, conversationId: "daily-materials", role: "user", content: prompt, createdAt: ... }], prompt)`，照抄 runtime.ts:167 的反思用法。

### 3.4 托管 event — `src/lib/server/agent/taskScheduler.ts:29`

仿照 `ensureMemoryReflectionEvent` 加 `ensureDailyMaterialsEvent(eventsDir, channel, botId, settings)`：

- 读 `settings.plugins.memory.dailyMaterials`（见 3.6）；`enabled === false` 或 `projectId` 为空时：若存在托管文件 `daily-materials.json` 则将其 `enabled` 置 false（不删除，保留 status），否则直接 return null；
- taskId = `daily-materials-${botId}`，文件名 `daily-materials.json`，schedule 由 `time`（HH:mm）转 cron，timezone 用 settings.timezone；
- `internal = { kind: "daily-materials", notificationChatId: notifications ? chatIds[0] : undefined, target: {ownerId:"owner", botId, timezone, sourceScopes: chatIds.map(...)}, promptPath, output: { projectId, dir } }`；
- 与现有函数相同的「内容未变则不重写、保留 status」逻辑（taskScheduler.ts:58）；
- 在 start() 的 `ensureMemoryReflectionEvent(...)` 调用点（taskScheduler.ts:155）旁边同样调用。

注意 sourceScopes 复用与反思相同的 chatIds 推导（web → `web:${botId}:web-anonymous`，其余 → instance.allowedChatIds）。

### 3.5 手动触发修复 — `src/routes/api/settings/tasks/+server.ts:643`

现状 bug（顺带影响现有 memory-reflection）：trigger action 对所有事件直接 `await manager.triggerTask(eventForRun, item.filename)`，internal 事件会被当普通 agent 任务误执行。

修复：文件顶部引入 `dispatchTaskEvent`（taskScheduler.ts:11 已导出）与 `getRuntime`（已引入）。在 periodic 分支和非 periodic 分支调用处：

```ts
if ((parsed as MomEvent).execution === "internal") {
  await dispatchTaskEvent(eventForRun, item.filename, manager, getRuntime().runInternalEvent);
} else {
  await manager.triggerTask(eventForRun, item.filename);
}
```

（dispatchTaskEvent 会处理 internal 分发和成功后的 notification。）

### 3.6 settings 三件套

- `src/lib/server/settings/schema.ts:180` `MemoryBackendSettings` 加：

```ts
dailyMaterials: {
  enabled: boolean;
  time: string;        // "HH:mm"，默认 "23:30"
  projectId: string;   // 空 = 未配置，任务不创建
  dir: string;         // 默认 "content/daily-materials"
  promptPath: string;  // 默认 "templates/daily-material-prompt.md"
  notifications: boolean;
}
```

- `src/lib/server/settings/defaults.ts:480` plugins.memory 内加对应默认值（enabled: false；支持 env 覆盖可选，不强求）。
- `src/lib/server/settings/sanitize.ts:941` 的 plugins.memory 块内加 dailyMaterials 清洗：time 用与 reflectionTime 相同的 `/^([01]\d|2[0-3]):[0-5]\d$/`；projectId/dir/promptPath trim；**dir 与 promptPath 拒绝绝对路径与 `..` 段**（`!path.isAbsolute && !segments.includes("..")`，非法时回退默认值）；注意 memoryPluginInput 可能是旧结构（无 dailyMaterials），要用 `?? current ?? default` 三级兜底。

### 3.7 Desktop 设置页

- `src/lib/shared/desktop.ts:835`（`@molibot/desktop-contract` 是它的 tsconfig 别名，见 apps/desktop/tsconfig.json，**只改这一个文件**）：
  - `DesktopPluginsSummary.memory` 加 `dailyMaterials: { enabled, time, projectId, dir, promptPath, notifications }` 与 `projects: Array<{ value: string; label: string }>`（下拉数据）；
  - `DesktopPluginsUpdateRequest` 加 `memoryDailyMaterials: { enabled, time, projectId, dir, promptPath, notifications }`。
- `src/lib/server/app/desktopPlugins.ts:94` buildDesktopPluginsSummary 填充上述字段（projects 从 `getProjectStore().list()` map 成 {value: id, label: name}）；`:133` buildDesktopPluginsSettings 校验并落 settings（time 正则、projectId 必须在 store 中存在或为空、路径校验同 sanitize）。
- `apps/desktop/src/lib/stores/plugins.svelte.ts:6` PluginsEditor 加对应字段，editorFromSummary/保存请求同步。
- `apps/desktop/src/lib/settings/PluginsSection.svelte:37` 反思时间控件下方加一组控件：启用 switch、time input、project select（数据源 summary.memory.projects，含空选项）、dir input、promptPath input、通知 switch。
- `apps/desktop/src/lib/api.ts` 的 saveDesktopPlugins 如果按字段展开传参需同步（若直接传 editor 对象则只改类型）。
- i18n：`apps/desktop/src/lib/i18n.ts` 双语加 key（zh/en 两处）：`memoryDailyMaterials`（每日素材任务 / Daily materials task）、`memoryDailyMaterialsEnabled`、`memoryDailyMaterialsTime`、`memoryDailyMaterialsProject`、`memoryDailyMaterialsDir`、`memoryDailyMaterialsPrompt`、`memoryDailyMaterialsNotifications` + hint 文案。用 grep 定位 `memoryReflectionTime` 的两处插入点。
- 可选加分项：任务列表对 `execution: "internal"` 的事件显示「内部任务」徽标并在删除时提示「由 Memory 设置管理」（apps/desktop/src/lib/settings/TasksSection.svelte）。

### 3.8 验证

- 聚焦测试：新建 `src/lib/server/memory/dailyMaterials.test.ts`，仿 `reflection.test.ts`（同目录，harness 模式照抄）：①投影→写文件→watermark 推进→重跑零产出；②project 不存在→throw 且 watermark 不推进；③abort 不推进；④输出 containment（dir 带 `..` 被拒）。
- `node --test` 相关套件、根项目 production build、`apps/desktop` svelte-check + vite build。
- 端到端：Desktop 配置（projectId 选 momo-agent、time 任意）→ 保存（scheduler restart 会创建 `daily-materials.json`）→ 自动化任务页手动触发 → 检查 momo-agent `content/daily-materials/<昨日>.md` 生成、通知送达首个允许 chat。
- 按 AGENTS.md 更新 features.md / CHANGELOG.md。

## 4. momo-agent 侧（/Users/gusi/Github/momo-agent）

1. 新建 `templates/daily-material-prompt.md`（提取指令模板，promptPath 默认指向它）。要点：
   - 声明用途：素材将用于生成魔魔视角的小红书内容，栏目 = docs/content-system.md 的六栏目；
   - 提取十问（来自 docs/market/定位.md §10.1）：今日主人做了什么 / 让魔魔做了什么 / 最大反差吐槽点 / 魔魔学到什么 / 新偏好 / 新项目记忆 / 可复用梗 / 适合哪个栏目 / 哪些不可公开 / 能否支撑 3 条候选；
   - 风格：魔魔第一人称、轻吐槽不贬低（引用 docs/character.md 语言规则）；
   - 过滤：寒暄与纯技术往返不记；脱敏（不出现账号/密钥/收入/身份/第三方隐私/未公开项目细节）；
   - 输出格式：按 `templates/daily-material.md` 骨架；**没有合格素材时只输出一行「今日无可用素材」**；
   - frontmatter 的 `source_grant` 填 event 的 taskId。
2. 新建 `templates/monthly-review.md`（对齐 README 提到的 `YYYY-MM.md`）：月度复盘骨架（发布/栏目分布、成长阶段判断、归档无效草稿、隐私与 AIGC 复核、内容记忆整理、下月主线）。
3. `docs/operations.md`「自动化接入契约」：`SourceGrant` 措辞改为「素材任务 event JSON 的 `internal.target.sourceScopes`」；补一句输出契约（写入 `content/daily-materials/`，模板 `templates/daily-material-prompt.md`）。
4. `README.md` 每日流程第 1-2 步：标注该内部任务由 Molibot `daily-materials` internal event 提供（实现前为人工整理）。
5. `docs/character.md` 末尾注明：成长阶段以 agent_self 记忆为权威，本文档为镜像。
6. review `momo-assets/` 目录（上个 session 无法列目录）：核对 docs/asset-catalog.md 是否与实际文件一致（catalog 说图片在 project 根目录，owner 说模板已在 momo-assets/，可能已搬移——如已搬移需更新 catalog 路径）。

## 5. 已知坑 / 注意

- 本 handoff 的 file:line 基于 2026-07-11 的工作区（molipibot 有未提交改动），执行前先确认没漂移。
- SessionReflectionSourceReader 的 watermark 查询键：见 3.2 第 2 点，必须解决 targetId 注入，否则素材任务会推进反思的 watermark（严重 bug）。
- sanitize 对旧 settings JSON（无 dailyMaterials 字段）必须无损兜底，否则启动即坏。
- Desktop plugins PUT（src/routes/api/desktop/plugins/+server.ts:14）走 `runtime.updateSettings` → 自动 `taskScheduler.restart`（runtime.ts:151），托管 event 会随保存即时重建——无需额外接线。
- 分类器故障期间未能 review momo-assets 与 i18n.ts 的精确插入点，执行时先 grep。