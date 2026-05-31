# 多渠道消息运行时分层重构 — 修正版实施计划

## 目标

把 Telegram、Feishu、QQ、Weixin 四个运行时里真正重复的“骨架逻辑”抽出来，但不强行抹平各渠道已经存在的发送细节。

这次重构的目标不是做一个“所有渠道都长得一样”的大一统运行时，而是做到下面三件事：

1. 新增渠道时，不必再复制一整套队列、去重、停任务、命令分发、提示词预览逻辑。
2. 各渠道继续保留自己的消息发送细节，不破坏现有体验。
3. 为后续展示分级做准备，但本次不提前接入展示分级，不扩大范围。

## 完成标准

这次任务只有同时满足下面几点才算完成：

1. Feishu、Weixin、QQ、Telegram 四个渠道都继续保留当前外部行为。
2. 共享逻辑被提到 `channels/shared`，但 Telegram 的流式状态更新、线程回复、ACP 交互能力不被削弱。
3. 文档同步更新：`implementation_plan.md`、`prd.md`、`features.md`。
4. 类型检查通过。
5. 现有相关测试通过。
6. 至少完成一轮与本次改动直接相关的运行时回归验证。

## 先修正判断

上一版计划的方向是对的，但有四个关键问题，必须先修掉：

1. 不能把 Telegram 的状态流、消息替换、线程回复硬塞进一个过于简单的统一 `ChannelIO`。
2. 统一层不能只围绕 `chatId` 工作，必须允许渠道保留“本次入站消息的回复上下文”。
3. 本次属于运行时重构，不应该顺手把展示分级一起接进去。
4. 验证方案必须改成仓库里真实可跑的命令，不能写 `npm test` 这种当前并不存在的脚本。

## 重构原则

### 只抽共享骨架，不抽平渠道行为

共享层只负责：

- 入站消息去重
- 队列管理
- 停止当前任务
- 通用命令分发
- 提示词预览写入
- 运行时公共日志与会话追加辅助

各渠道自己保留：

- 如何发送消息
- 是否支持编辑消息
- 是否支持删除消息
- 如何处理首条回复
- 如何处理线程 / topic / replyTo
- 如何处理附件上传
- 如何处理流式状态更新
- ACP 的渠道特有交互

### 抽“骨架 + 钩子”，不是抽“万能基类”

本次不追求一个把所有运行时都包完的超级抽象。

更稳妥的形态是：

- 一个共享运行时基座，负责公共状态和通用辅助方法
- 一组共享 helper，负责真正重复的方法
- 每个渠道只接入自己用得上的部分

换句话说，本次核心是“复用共享骨架”，不是“所有流程都进基类模版方法”。

## 实施范围

### 本次实施范围

1. 抽取共享运行时状态与 helper。
2. 迁移 Feishu、Weixin、QQ 的明显重复逻辑。
3. Telegram 只接入真正安全的共享部分，不强拆流式输出和 ACP 回调交互。
4. 补充最小必要的运行时测试。

### 明确不在本次范围

1. Presentation Builder / Renderer 落地
2. Domain Event 总线接入 runner
3. Audit / Trace Store
4. Web 端统一接入本套运行时
5. 为了抽象而改现有消息展示行为

## 设计修正

### 1. 共享基座只管理公共状态

新增：

- `src/lib/server/channels/shared/baseRuntime.ts`

这个基座负责持有公共字段与公共辅助能力，例如：

- `store`
- `sessions`
- `runners`
- `memory`
- `acp`
- `commandService`
- `chatQueues`
- `running`
- `inboundDedupe`

并提供这些共享方法：

- `markInboundMessageSeen`
- `getQueue`
- `stopChatWork`
- `appendAssistantMessage`
- `appendUserMessage`
- `writePromptPreview`

注意：

- `processEvent` 不先强制统一。
- `buildMomContext` 不先在基类里做成唯一实现。
- Telegram 不需要为了继承而牺牲现有流程。

### 2. 把发送能力拆成“上下文感知”的渠道回复器

上一版 `ChannelIO(chatId)` 太薄，不够表达真实差异。

修正后不使用“只靠 chatId 发消息”的接口，而改成更接近下面这种思路：

```ts
type ChannelResponseHandle<TInbound, TSent> = {
  sendText(text: string, options?: ResponseOptions): Promise<TSent | null>;
  editText?(sent: TSent, text: string): Promise<boolean>;
  deleteMessage?(sent: TSent): Promise<boolean>;
  uploadFile?(filePath: string, title?: string, text?: string): Promise<void>;
  setTyping?(isTyping: boolean): Promise<void>;
};
```

重点变化：

- 回复器从“当前这条入站消息”构建出来
- 渠道自己决定 replyTo、topic、首条 reply、QQ target、微信 sourceMessage
- 统一层只消费这个回复器，不再猜渠道细节

### 3. 把共享 `MomContext` 组装做成 helper，不做成唯一模板

新增一个共享 helper，例如：

- `src/lib/server/channels/shared/contextBuilder.ts`

它负责组装 Feishu / QQ / Weixin 这类普通文本渠道都能复用的默认 `MomContext` 行为：

- `respond`
- `replaceMessage`
- `deleteMessage`
- `respondInThread`
- `uploadFile`
- `setTyping`
- 会话追加
- 机器人消息日志

但允许渠道覆盖：

- 如何维护最后一条消息
- 是否忽略重复 replace
- 文件失败后的降级策略
- 线程回复策略

Telegram 不直接吃默认版，而是只复用其中能安全复用的日志和会话辅助。

### 4. Telegram 采用“最后迁移、有限接入”

Telegram 当前包含独有能力：

- 状态消息持续更新
- 线程回复消息组
- typing 与 working 协同
- 文件按图片 / 语音 / 文档分别发送
- ACP permission callback

所以 Telegram 在本次只迁移下面这些确定安全的部分：

- 去重
- 队列
- 停任务
- 提示词预览
- 通用命令分发

下面这些继续保留在 Telegram 自己的 runtime：

- `processEvent`
- 流式渲染逻辑
- ACP 回调与按钮交互
- topic / reply_parameters 细节

### 5. Presentation Policy 只保留为后续说明，不在本次落代码

`presentationPolicy.ts` 不在本次创建。

原因：

- 当前运行时重构并不会实际使用它
- 提前落一个未接线的抽象，只会增加维护噪音
- 这部分应在 Builder / Renderer 真正开始时再建

如果需要，只在文档里保留“后续阶段”说明，不在本次代码里落空文件。

## 实施顺序

### Phase 1：共享骨架

1. 新建 `channels/shared/baseRuntime.ts`
2. 新建 `channels/shared/contextBuilder.ts`
3. 把去重、队列、停任务、提示词预览、会话追加辅助抽到共享层

### Phase 2：先迁移普通文本渠道

1. Feishu 接入共享骨架
2. Weixin 接入共享骨架
3. QQ 接入共享骨架

这一阶段目标是让三条普通文本渠道先收敛到一致的结构。

### Phase 3：最后处理 Telegram

1. Telegram 只接入共享骨架里确认安全的部分
2. 保留 Telegram 自己的 `processEvent`
3. 不碰 Telegram 的流式输出能力设计

## 每个渠道的处理策略

### Feishu

优先迁移，作为最简单样板：

- 去重迁移到共享层
- 队列迁移到共享层
- 停任务迁移到共享层
- 提示词预览迁移到共享层
- `processEvent` 改为调用共享 context helper

### Weixin

第二个迁移：

- 复用共享骨架
- 保留首条 reply / 后续 send 的差异
- 保留打字状态与文件发送失败降级

### QQ

第三个迁移：

- 复用共享骨架
- 保留 `c2c/group/channel` 目标差异
- 保留“无 edit 能力”的特殊处理

### Telegram

最后迁移：

- 只把共享骨架接进去
- 不把流式状态逻辑塞回共享 helper
- 不为“统一代码形态”牺牲体验

## 测试与验证方案

### 自动检查

本次改完后，至少运行下面这些：

```bash
cd ~/Github/molipibot
npx tsc --noEmit
node --test src/lib/server/channels/telegram/formatting.test.ts
node --test src/lib/server/channels/weixin/media.test.ts
node --test src/lib/server/channels/weixin/outbound.test.ts
```

### 需要补的最小测试

这次重构涉及运行时共享层，现有测试不够，所以应补最小必要测试，优先覆盖：

1. 去重 helper
2. 队列 helper
3. 普通文本渠道的共享 context 行为
4. 无 edit 渠道的 `replaceMessage` 降级行为

### 手动回归

如果本地环境允许，要至少验证一轮：

1. 普通消息正常回复
2. `/help`
3. `/stop`
4. 会话切换类命令
5. 至少一个附件相关路径

其中 Telegram 还要额外看：

1. 流式状态是否还在更新
2. topic / reply 行为是否正常

## 风险控制

### 风险 1：抽象过度，导致 Telegram 退化

处理方式：

- Telegram 最后接入
- 只迁移安全部分
- 不把 Telegram 的核心发送状态机并入普通 helper

### 风险 2：表面重构，实际行为悄悄变了

处理方式：

- 每迁移一个渠道就立刻跑检查
- 保留渠道自己的发送细节和降级策略
- 不在同一批里顺手改展示文案

### 风险 3：共享层反而变成新的大泥球

处理方式：

- 共享层只放明确重复的内容
- 复杂差异继续留在渠道侧
- 有条件才抽，不为了“整齐”而抽

## 文档同步要求

本次实现后必须同步更新：

- `features.md`：记录“共享运行时骨架重构”已完成内容与日期
- `prd.md`：补一条运行时分层约束，明确共享层与渠道钩子的边界

## 本次实施结论

本次按“共享骨架 + 渠道钩子”的路线实施，不按上一版“一个万能基类统一所有运行时”的路线实施。

这是更稳、更符合现状、也更容易验证的方案。
