# 定时任务 Fresh Session 设计与实现

> 2026-06-13 实现。解决周期性定时任务（黄金日报、新闻简报等）导致 session 历史无限累积、token 消耗逐日增长的问题。

## 1. 背景：问题是怎么被定位的

最初的问题表述是"token 越用越多,session 压缩是不是该更频繁、触发时机准不准"。排查后结论是:**压缩不是主因,定时任务复用长期 session 才是**。

### 1.1 累积路径

定时事件触发链:

```
TaskScheduler → EventsWatcher → manager.triggerTask(event)
  → handleSyntheticEvent / processEvent
  → sessionId = event.sessionId || store.getActiveSession(scopeId)   ← 问题点
```

所有定时任务都追加进聊天的 **active session**。每天的日报全文留在 session 里,第二天运行时,之前所有报告都作为 input token 重新发给模型——而旧报告对生成新报告几乎没有价值。这是**线性累积**的纯浪费。

### 1.2 为什么不是调压缩参数

排查中同时发现压缩机制的两个事实,但都不值得作为本问题的解法:

- **触发估算对中文低估 2~3 倍**:`estimateMessageTokens` 用 `length / 4`(英文经验值),中文约 1~1.5 字符 = 1 token。中文日报场景下,阈值压缩(默认 200k 窗口的 75%)几乎只能靠 context overflow 报错后的兜底重试触发。
- **频繁压缩反而更贵**:压缩本身要一次摘要调用(最多 12 万字符输入),且改写历史开头会导致 **prompt cache 全部失效**,下次请求全量 cache write。

核心判断:**压缩是"把垃圾变小",fresh session 是"根本不带垃圾"**。对定时任务场景,后者收益大一个量级。

## 2. 设计

### 2.1 关键区分:fresh ≠ ephemeral

fresh session 只是"**开始时**不带旧历史",它本身照常持久化。任务运行的全部上下文(工具调用、查到的数据、生成的报告)都保留在这个 session 里。

### 2.2 反馈/微调场景的解法

需求:任务跑完结果不满意,希望直接在聊天里回复进行微调。

方案:**fresh session 创建后立即设为 active**。流程:

1. 定时任务触发 → `beginTaskSession` 创建新 session(`task-` 前缀)并切换 active 指针;
2. 任务在其中运行,报告发到聊天;
3. 用户在聊天里回复 → 普通消息走 `getActiveSession` → 自然落入该任务 session,微调上下文完整;
4. 第二天任务再触发 → 又开新 session 并切 active,昨天的 session(含微调对话)自然归档,不再进入今天的 context。

已知副作用:如果任务发往的是用户**同时在聊别的事情**的聊天,任务一跑 active 会被切走,正在进行的对话被打断。当前选择接受这个副作用(fresh 模式推荐用于专门的报告聊天);完整方案(报告 messageId → sessionId 映射,reply-to 路由)记录在 §6 待办。

### 2.3 Session 爆炸的解法:按保留期自动清理

每天开新 session 会堆积大量无用 session。清理设计:

- **触发时机**:每次 `beginTaskSession` 时顺带清理(无需独立定时器/调度);
- **识别**:只清理 `task-` 前缀的 session,**用户手动创建的 session(`s-` 前缀)和 active session 永不删除**;
- **过期判定**:按 session entries 文件 **mtime**(最近活跃时间),而非创建时间——用户微调过的 session 会自动延寿;
- **保留期**:`settings.events.taskSessionRetentionDays`,默认 7 天,0 = 不清理,env `MOLIBOT_EVENT_TASK_SESSION_RETENTION_DAYS`。

### 2.4 默认值选择

`sessionMode` 默认值按事件类型区分(`resolveEventSessionMode`):

| 事件类型 | 默认 sessionMode | 理由 |
|---|---|---|
| periodic | **fresh** | 周期任务(日报类)正是累积问题的来源 |
| one-shot / immediate | chat | 提醒/即时事件通常是对话的延续,需要聊天上下文 |

显式指定 `sessionMode` 时覆盖默认。periodic 默认 fresh 意味着**存量任务无需修改配置**即可受益。

## 3. 实现步骤(按提交顺序)

### Step 1: 事件 schema

[src/lib/server/agent/events.ts](../../src/lib/server/agent/events.ts)

- `EventBase` 增加 `sessionMode?: "fresh" | "chat"`(`EventSessionMode`);
- `resolveEventSessionMode(event)`:显式值优先,否则 periodic → fresh、其余 → chat;
- `taskSessionRetentionMs(days)`:天数 → 毫秒,`<= 0` 或非法返回 `undefined`(表示不清理)。

### Step 2: Session 存储

[src/lib/server/agent/session/store.ts](../../src/lib/server/agent/session/store.ts)

- `beginTaskSession(chatId, retentionMs?)`:创建 `task-<ts36>-<rand>` session,确保 context/entries 文件存在,`setActiveSession`,然后(若给了 retentionMs)调用清理;
- `pruneTaskSessions(chatId, retentionMs)`:遍历 `listSessions`,过滤 `task-` 前缀且非 active 的 session,取 entries/context 文件 mtime 的较大者作为最近活跃时间,早于 cutoff 则 `deleteSession`(其"不能删最后一个 session"的保护天然兜底)。

### Step 3: 设置项

四处同步增加 `taskSessionRetentionDays`:

- [settings/schema.ts](../../src/lib/server/settings/schema.ts):`EventExecutionSettings` 增加字段;
- [settings/defaults.ts](../../src/lib/server/settings/defaults.ts):默认 7,env 可覆盖,非法值回退 7;
- [settings/sanitize.ts](../../src/lib/server/settings/sanitize.ts):clamp 0–365;
- [settings/store.ts](../../src/lib/server/settings/store.ts):持久化输入类型、sanitize、导出三处。

注意:`events.ts` 里的 `EventExecutionSettings`(watcher 用,3 字段)与 `schema.ts` 的同名接口(4 字段)是两个类型,TS 结构化兼容,watcher 不需要新字段。

### Step 4: 渠道接线

入站消息类型 [core/types.ts](../../src/lib/server/agent/core/types.ts) 的 `ChannelInboundMessage` 增加 `sessionMode?: "fresh" | "chat"`。

接线分两半:

**(a) 打标记** —— 四个渠道的 `triggerTask`/`handleSyntheticEvent` 构造 synthetic 消息时设置:

```ts
sessionMode: resolveEventSessionMode(task)
```

**(b) 解析** —— session 解析收敛到一个共享方法 [shared/baseRuntime.ts](../../src/lib/server/channels/shared/baseRuntime.ts):

```ts
protected resolveInboundSessionId(scopeId, event): string {
  if (event.isEvent && event.sessionMode === "fresh") {
    return this.store.beginTaskSession(
      scopeId,
      taskSessionRetentionMs(this.getSettings().events?.taskSessionRetentionDays)
    );
  }
  return this.store.getActiveSession(scopeId);
}
```

各渠道的调用点(均为原 `event.sessionId || getActiveSession(scopeId)` 的位置):

| 渠道 | 路径 |
|---|---|
| telegram | `processEvent`(流式) |
| feishu 流式 | `processEvent` |
| feishu 非流式 / weixin / qq | `BaseChannelRuntime.runSharedTextTask`(三者共用,改一处) |

`event.sessionId` 显式指定时仍然最优先(向后兼容)。

### Step 5: createEvent 工具

[agent/tools/event.ts](../../src/lib/server/agent/tools/event.ts):schema 增加 `sessionMode` 可选参数,三种事件类型的构造均透传,工具描述里写明 fresh/chat 语义、默认值和自动清理行为,让 agent 创建任务时可以显式控制。

### Step 6: 测试

[session/taskSessions.test.ts](../../src/lib/server/agent/session/taskSessions.test.ts)(node:test + tsx,5 用例):

1. `beginTaskSession` 创建 `task-` 前缀 session 并设为 active;
2. 清理:过期 task session 被删、同样过期的用户 session 不被删、新 task session 与 active 保留(用 `utimesSync` 伪造 mtime);
3. 不传 retention 时不清理;
4. `resolveEventSessionMode` 默认值与显式覆盖;
5. `taskSessionRetentionMs` 换算与 0/undefined 禁用。

## 4. 行为总结(用户视角)

- 周期任务(日报等)**无需改配置**,下次触发自动用全新 session,token 不再随天数累积;
- 报告发出后**直接在聊天里回复即可微调**,上下文完整;
- 旧任务 session 默认保留 7 天后自动清理,微调过的会按最近活跃时间顺延;
- 需要聊天上下文的任务,创建时指定 `sessionMode: "chat"` 即可回到旧行为。

## 5. 取舍记录

| 决策 | 备选 | 选择理由 |
|---|---|---|
| fresh session 设为 active | 不切 active + reply-to 映射路由 | 简单,且报告类任务通常发往专用聊天;映射方案留作后续 |
| 清理挂在 beginTaskSession 上 | 独立定时清理任务 | 无新增调度面;不跑任务就不产生新 session,也就不需要清理 |
| 按 mtime 判过期 | 解析 session id 里的创建时间戳 | 微调中的 session 自动延寿,不会删掉正在用的 |
| periodic 默认 fresh | 全部默认 chat、按事件显式开启 | 符合"完整端到端改动优于临时半步"的协作约定;存量日报任务立即受益 |

## 6. 后续可做(本次未实现)

1. **压缩触发改用真实 usage**:runner 已拿到每次请求的真实 `inputTokens`/`cacheRead`(`runner.ts` usage 采集处),把"上次请求实际 input tokens"存下来驱动 `shouldCompactContext`,char/4 只做冷启动 fallback——修复中文低估 2~3 倍导致的触发时机不准。
2. **摘要用便宜模型**:压缩目前用主对话模型(`turnOrchestrator.compact` → `resolveModelSelection(settings, "text")`),可加 `compactionModelKey` 指到 Haiku 级模型。
3. **reply-to 路由**:记录报告 messageId → sessionId 映射,回复报告消息时路由进对应 session,普通消息走原 active session,消除"混用聊天中 active 被切走"的副作用。
4. **run 中段压缩检查**:阈值压缩目前只在 run 开始(`candidateIndex === 0`)检查一次,长工具链 run 只能靠 overflow 兜底;可考虑每 N 轮工具调用后再检查。
