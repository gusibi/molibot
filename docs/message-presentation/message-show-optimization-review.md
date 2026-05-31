# Message Show Optimization Review

本文整理 Molibot 在 Telegram / Weixin 等消息通道上的回答展示问题、根因，以及建议的改进方案，供 review 使用。

## 1. 问题结论

当前问题不在于“是否只展示最终结果”，而在于：

- runtime 目前默认假设：一个 turn 只有一条主答案
- 因此把后续 assistant 文本统一当成这条主答案的继续编辑或新版覆盖
- 但真实运行里，模型有时会在已经给出完整分析后，又额外生成一条新的 assistant 收尾消息
- 在 Telegram 这类支持编辑的通道里，后一条会直接编辑覆盖前一条
- 在 Weixin / QQ 这类不支持编辑的通道里，runtime 通过本地 buffer 模拟 replace，结果也是后一条覆盖前一条

所以现在丢失的不是中间垃圾文本，而经常是已经足够完整、应该对用户保留的最终分析。

## 2. 真实案例

### 2.1 Weixin

Weixin session 中出现了两条连续 assistant：

- 第一条是完整分析
- 第二条是模型在 tool-call 预算提醒后，又补发的一条简版结论

用户最终只收到了第二条。

这不是 session 持久化丢失，因为上下文文件里两条都存在；问题出在 Weixin runtime 的 `messagesBuffer + replaceWithoutEdit` 逻辑：后一条文本在 flush 前替换掉了前一条缓冲内容。

### 2.2 Telegram

Telegram session 同样出现两条连续 assistant：

- 第一条已经是完整最终分析
- 第二条是“分析已经完整，无需进一步调用工具”之后的再次总结

用户最终只看到了第二条。

这不是 Telegram 平台限制，而是 Telegram runtime 的设计就是维护一个 `answerMessageId`，后续答案默认都通过 `editMessageText` 编辑同一条消息。

因此：

- 如果两条 assistant 其实是同一条答案的继续润色，这种设计是合理的
- 但如果两条 assistant 已经是两条独立 final answer，后者覆盖前者就会造成信息丢失

## 3. 当前实现的根因

### 3.1 Telegram

Telegram runtime 当前维护一条可见主答案消息：

- `status.answerMessageId`
- `status.accumulatedText`

后续 assistant 文本默认进入同一条答案消息，并被编辑覆盖。

这套机制对真正的流式生成是正确的，但当前没有区分：

- 同一条答案的流式更新
- 已经结束后，又新生成了一条 assistant 回答

于是第二种情况也被当成 replace 处理。

### 3.2 Weixin / QQ

Weixin / QQ 由于不支持编辑消息，runtime 用本地 buffer 模拟 replace：

- 先把文本推入 `messagesBuffer`
- 如果后面来了新的 replace 文本
- 就把旧的 `state.accumulatedText` 从 buffer 里删掉，再塞入新版

这本质上和 Telegram 的 edit 是同一个设计，只是实现形式不同。

问题同样在于：它没有区分流式更新和第二条独立回答。

### 3.3 shared context 层

`buildTextChannelContext` 当前提供的语义主要是：

- `respond`
- `replaceMessage`
- `beginContinuationResponse`
- `respondInThread`

但它没有为“主答案已经提交，后续文本不能再覆盖”提供统一抽象。结果每个渠道都在各自 runtime 里用本地状态模拟“编辑中的同一条答案”，而没有“答案冻结点”的概念。

## 4. 设计目标

本次优化的目标不是改成“所有渠道都只发最终结果”，而是修正主答案生命周期。

### 目标

1. 保留 Telegram / Feishu / Weixin / QQ 现有的单消息流式体验
2. 避免完整最终分析被后续简短结论覆盖
3. 不依赖文本语义猜测“这是不是总结”
4. 让渠道行为统一：同样的 runner 输出，在不同渠道上不再出现一边保留、一边覆盖的随机差异

### 非目标

1. 不做复杂 NLP/分类器去判断“总结语气”
2. 不改变现有工具进度、审批消息、运行详情消息的职责边界
3. 不把所有 assistant 文本都机械拆成多条消息

## 5. 最佳改进方案

最佳方案不是做模糊的“总结/收尾文本识别”，而是引入一套显示状态机：

- `draft_answer`
- `committed_answer`
- `postscript`

核心原则：

1. 同一条主答案在 `draft` 阶段允许流式编辑
2. 一旦某条 assistant 文本被认定为主答案已提交给用户，就冻结为 `committed`
3. `committed` 之后再出现新的 assistant 文本，不允许再覆盖旧主答案
4. 后续文本只允许两种处理：丢弃，或作为单独补充消息发出

### 5.1 为什么不用语义判断

因为“总结/收尾/补充”在语言上很模糊：

- 模型风格会变
- 不同语言、不同 provider、不同 prompt 会产生不同表达
- 同样一句“总结一下”，有时是信息压缩，有时是真正新增观点

而“这条主答案是否已经 committed”是运行时可稳定判断的状态，不依赖文本内容。

### 5.2 建议的状态流转

```text
start
  -> draft_answer
  -> committed_answer
  -> postscript? (0..n)
  -> end
```

规则：

1. `draft_answer` 阶段允许持续更新
2. 在 runner 完成主回答提交点时，把 draft 冻结为 `committed_answer`
3. `committed_answer` 之后出现的新 assistant 文本，不再走 replace 主路径

## 6. committed 之后的处理

推荐一个保守、稳定的默认策略：

1. 默认不覆盖旧主答案
2. 把后续文本标记为 `postscript candidate`
3. 再按结构规则处理：
   - 很短，且没有新结构信息：丢弃
   - 明显带有新增结构信息：单独作为补充消息发送

这里仍然不做语义判断，只做非常保守的结构判断，例如：

- 是否出现新链接
- 是否出现新文件/附件引用
- 是否出现新表格
- 是否出现新数字块/日期块/价格块
- 是否是新的错误说明或告警

如果没有，就不值得覆盖主答案，也不值得单独多发一条消息。

## 7. 各渠道落地建议

### 7.1 shared context 层

优先在 shared 层补统一抽象，而不是让每个 channel 自己猜。

建议在 shared context / runtime 层增加：

- `mainAnswerPhase: "draft" | "committed"`
- `commitMainAnswer()`
- `handlePostscript(text)`

这样各渠道都能复用同一套生命周期判断。

### 7.2 Telegram

Telegram 当前的 `answerMessageId + accumulatedText` 很适合继续保留，但要加一条规则：

- `draft` 阶段：继续 `editTelegramText`
- `committed` 之后：禁止再 edit 已有 `answerMessageId`

后续文本进入 `postscript`：

- 默认丢弃
- 如满足结构补充规则，再发第二条补充消息

### 7.3 Weixin / QQ

Weixin / QQ 当前的问题点在 `replaceWithoutEdit`：

- 它们会把旧的 `state.accumulatedText` 从 `messagesBuffer` 删除
- 然后塞入新的文本

建议改成：

- `draft` 阶段允许删旧换新
- 一旦主答案 committed，buffer 中的 committed 主答案不能再被后续文本删除

后续文本进入 `postscript` 流程，而不是继续 `replaceWithoutEdit`

### 7.4 Feishu

Feishu 的卡片流式展示路径也应套同样规则：

- final answer block committed 后冻结
- 后续 assistant 文本不再覆盖 answer block
- 如需保留，改为第二个补充 block / 第二条补充消息

## 8. 推荐实现顺序

### Phase 1：收口 shared 语义

先把“主答案冻结点”变成 shared runtime 的统一概念：

1. 定义 `draft/committed/postscript`
2. 在 `buildTextChannelContext` 或上层 response orchestration 中统一持有状态
3. 明确 main answer 的 commit 时机

### Phase 2：先修 Telegram + Weixin

优先修复两个已经出现真实问题的渠道：

1. Telegram
2. Weixin

QQ 基本可以跟 Weixin 同路径一起改。

### Phase 3：补 Feishu 对齐

Feishu 行为虽然未必已经暴露同样缺陷，但为了共享一致性，应补齐。

## 9. 回归测试建议

### 9.1 shared 层

1. `draft` 阶段多次 replace，只保留最后一版主答案
2. `committed` 之后再来 assistant 文本，不允许覆盖 committed 主答案
3. `postscript candidate` 无结构新增时被丢弃
4. `postscript candidate` 有结构新增时单独发补充

### 9.2 Telegram

1. 同一轮里先完整回答，再来一句简短总结，最终 Telegram 可见消息保留完整回答
2. 同一轮里先 draft 流式增量，再 finalize，仍保持单消息编辑体验
3. committed 后新增结构补充时，发送第二条补充消息而不是覆盖第一条

### 9.3 Weixin / QQ

1. buffer replace 在 draft 阶段仍然工作
2. committed 后 `messagesBuffer` 不再删除旧主答案
3. flush 后最终可见文本保留完整分析

### 9.4 Feishu

1. committed 后卡片最终答案 block 不被后续短文本覆盖
2. 补充信息走第二 block / 第二条消息

## 10. review 建议关注点

review 时建议重点看这几个问题：

1. 主答案的 `commit` 时机应该定义在哪一层，shared context 还是各 channel runtime？
2. `postscript` 默认应该丢弃，还是默认作为第二条补充消息发出？
3. 结构补充规则是否需要最小集合实现，还是第一版先全部丢弃更稳？
4. Telegram / Weixin / QQ / Feishu 是否应该统一行为，还是允许 Telegram 保留更积极的补充显示？

## 11. 最终建议

推荐采用下面这个原则，作为 review 基准：

> Molibot 应继续保留“单消息流式更新”的主路径，但必须在主答案提交后冻结该答案，禁止后续 assistant 文本覆盖它。

换句话说：

- 不是去做“总结识别”
- 而是引入“主答案生命周期管理”

这是当前最稳、最可维护、最能跨渠道统一的方案。
