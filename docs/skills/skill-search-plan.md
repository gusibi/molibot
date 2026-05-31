# Skill Search 改造方案（待确认）

日期：2026-04-18
状态：Implemented (initial version)

说明：本文档最初用于实现前确认方案；2026-04-18 已按首版方案完成代码落地，后续仍可继续在此文件上补充或修订。

## 1. 目标

把当前“主要依赖提示词自己识别 skill”的方式，改成“运行时显式检索 skill”。

本次先做可配置版本，不直接强制所有检索路径生效。目标是：

- 提高 skill 命中稳定性，减少“明明有 skill 但模型没用”的情况
- 允许运营在设置页独立开关“本地搜索”和“API 复判”
- 允许运营配置 API 搜索所使用的提供方、模型和请求参数
- 在运行时减少对完整 skill 描述长列表的依赖，为后续简化系统提示词做准备

## 2. 现状问题

- 当前运行时虽然会加载所有 skills，但主要还是靠系统提示词中的技能清单让模型自己判断是否使用
- 显式调用（如 `/skill-name`）已经较稳，但隐式命中仍然不稳定
- 当前系统提示词会注入 skill 名称和 description，动态内容较长，且对模型是否触发 skill 没有硬约束
- skill description 很多是中文；如果用户请求是英文，仅靠本地字符串匹配很容易漏掉

## 3. 本次确认后的产品决策

### 3.1 检索层级

Skill Search 支持两层，但都做成独立开关：

1. 本地搜索
2. API 复判

允许的组合：

- 只开本地搜索
- 只开 API 复判
- 两个都开
- 两个都关（回退到现有纯提示词模式）

### 3.2 默认策略

首版默认建议：

- 本地搜索：关闭
- API 复判：关闭

原因：

- 先以“可控试验”方式上线，避免一上来改变所有会话行为
- 便于逐项验证缓存、命中率、延迟和误判率

### 3.3 运行顺序

如果两个都开启，顺序如下：

1. 先走本地搜索
2. 如果本地搜索命中足够明确，则直接采用结果
3. 如果本地搜索无命中，或命中不明确，再走 API 复判

如果只开 API 复判，则直接跳过本地搜索。

### 3.4 系统提示词简化方向

本次实现后，系统提示词中的 `Available Skills` 计划简化为“名称为主”的轻量清单，不再默认注入完整 description 长列表。

说明：

- 运行时真实检索由 `skill_search` 路径承担
- description 仍保留在技能元数据和设置页中，不删除文件字段
- 系统提示词中仅保留足够的运行时规则和最小技能索引，避免长 prompt 干扰缓存与主任务判断

## 4. 触发原则

Skill Search 不会用于所有纯文本回答。

拟定触发条件：

- 需要调用工具
- 需要执行 bash / script / 文件操作
- 需要联网或外部查询
- 需要生成媒体、跑工作流、执行某种可复用流程

不触发的情况：

- 纯闲聊
- 纯重写/翻译/总结
- 不需要任何外部动作的直接文本回答

后续实现上，触发判断分两部分：

- 系统提示词规则继续保留
- 运行时新增显式 `skill_search` 工具，并让模型在这些场景下优先调用

说明：本次先不做“服务端强制预查并直接改写输入”的硬拦截，首版仍以工具化接入为主，避免改动过大。

## 5. 本地搜索方案

### 5.1 目的

提供一个低成本、低延迟的第一层筛选。

### 5.2 搜索来源

本地搜索使用现有已加载 skill 元数据，不额外发模型请求。

首版检索字段建议：

- `name`
- `aliases`
- `description`
- 目录名别名

后续可扩展：

- `triggers`
- `tags`
- `examples`

### 5.3 返回形式

本地搜索返回：

- 候选 skill 列表
- 每个 skill 的简单分数
- 命中原因摘要（例如 name / alias / description）

### 5.4 明确命中规则

只有当第一名分数明显高于其他候选，才视为“明确命中”。

否则：

- 若 API 复判开启，则进入 API 复判
- 若 API 复判关闭，则返回“无明确命中”，让模型继续走普通流程

### 5.5 本地搜索开关

新增设置项：

- `skillSearch.local.enabled`

可选扩展设置：

- `skillSearch.local.maxResults`
- `skillSearch.local.minScore`
- `skillSearch.local.minScoreGap`

首版可先只做 `enabled`，其余先保留后续扩展空间。

## 6. API 复判方案

### 6.1 目的

解决跨语言、同义表达、描述较抽象时的命中问题。

### 6.2 基本思路

由单独小模型做“skill 是否匹配”的判断。

它不是直接执行 skill，只负责：

- 理解当前任务意图
- 在候选 skill 中选择最合适的一个
- 或明确返回“没有合适 skill”

### 6.3 请求内容

为了兼顾准确度和缓存稳定性，首版不建议只发“两三个字的意图”。

建议发送：

- 一条简化后的任务意图句子
- 当前可选 skill 列表
- 每个 skill 的 `name`
- 每个 skill 的 `description`
- 可选的 `aliases`

说明：

- 如果未来担心 token 成本，可再加“是否先本地筛选候选再发 API”的策略
- 但按本次决策，首版必须支持“关闭本地搜索，仅走 API 复判”

### 6.4 API 结果格式

API 复判输出建议固定结构：

- `matched: boolean`
- `skillName: string | null`
- `confidence: number`
- `reason: string`

运行时采用规则：

- `matched = true` 且 `confidence` 达标，才算命中
- 否则回退普通流程

### 6.5 API 搜索配置项

新增设置项：

- `skillSearch.api.enabled`
- `skillSearch.api.provider`
- `skillSearch.api.baseUrl`
- `skillSearch.api.apiKey`
- `skillSearch.api.model`
- `skillSearch.api.path`
- `skillSearch.api.maxTokens`
- `skillSearch.api.temperature`
- `skillSearch.api.timeoutMs`
- `skillSearch.api.minConfidence`

说明：

- 字段风格尽量与现有 custom provider 配置保持一致
- 后端保存时要走统一 settings 流程，不单独手写文件

### 6.6 与缓存的关系

API 复判如果总是发送相同结构的 skill 清单，理论上更有利于缓存。

但本方案不把缓存当成前提，只视为附加收益：

- 能命中缓存更好
- 命不中也必须可正常工作

## 7. 设置页改动方案

### 7.1 页面位置

先放在现有 `/settings/skills` 页面内。

原因：

- 操作者在查看技能时，最自然也会希望顺手配置技能检索行为
- 不额外拆新页面，改动更小

### 7.2 页面新增区域

在现有技能列表上方新增一块“Skill Search”配置区。

拟包含：

- `Enable local search` 开关
- `Enable API search` 开关
- API provider / model / baseUrl / path / key 等输入项
- 说明文案：本地搜索用于快筛，API 搜索用于语义复判

### 7.3 保存方式

继续复用 `/api/settings` 的统一保存接口。

## 8. 运行时改动方案

### 8.1 新增运行时设置结构

在 `RuntimeSettings` 中新增：

```ts
interface SkillSearchSettings {
  local: {
    enabled: boolean;
  };
  api: {
    enabled: boolean;
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    path: string;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    minConfidence: number;
  };
}
```

最终字段命名可按现有设置风格微调，但语义保持一致。

### 8.2 新增工具

新增一个显式工具：

- `skill_search`

入参建议：

- `intent`
- `max_results`

返回建议：

- `matches`
- `source` (`local` / `api` / `local+api`)
- `reason`
- `confidence`（如果有）

### 8.3 工具行为

根据 settings 组合决定搜索路径：

- 仅本地
- 仅 API
- 本地失败后再 API
- 全关时直接返回空结果

### 8.4 命中后的后续动作

`skill_search` 只负责找 skill，不直接执行 skill。

命中后仍沿用现有机制：

- 把选中的 `skill_file` 注入运行时上下文
- 模型继续读取并执行该 skill

### 8.5 显式调用优先级

`/skill-name`、`$skill-name` 这类显式调用仍然优先于 `skill_search`。

即：

- 显式点名 skill：直接按现有逻辑命中
- 未显式点名：才进入 `skill_search`

## 9. 提示词改动方案

### 9.1 保留的内容

- skill-first 的原则
- 什么时候应该优先 skill_search
- 显式 skill 调用规则

### 9.2 删除或压缩的内容

- 不再把全部 skills 的 description 大段塞进系统提示词
- `Available Skills` 改为轻量索引，只保留名称、别名、路径等最小信息

### 9.3 新的核心规则

系统提示词改成：

- 遇到可执行任务，先调用 `skill_search`
- 搜到 skill 就优先用
- 搜不到再走普通工具或手工方案

## 10. 首版不做的事

- 不上向量搜索
- 不做独立向量库
- 不做服务端硬拦截式“每次都先替模型查完再强塞结果”
- 不改 skill 文件格式为必须新增 tags/triggers/examples
- 不删除 skill 的 description 字段

## 11. 风险与待确认点

### 11.1 风险

- 如果只开 API 搜索，单次请求会增加延迟和成本
- 如果 API 复判太激进，可能会“硬选错 skill”
- 如果提示词简化过头，且用户没开 search，技能命中率可能短期下降

### 11.2 待你确认的问题

1. `Skill Search` 配置是否放在 `/settings/skills` 页面，还是单独拆新页？
2. 首版默认值是否按“本地关、API 关”来做？
3. API 配置是否直接复用现有 custom provider 风格字段，还是只做最小版（baseUrl/model/apiKey/path）？
4. 系统提示词里的 `Available Skills` 是否直接缩成“只显示名字”，还是保留“名字 + 路径”？

## 12. 实施顺序（确认后执行）

1. 扩展 settings schema/default/store/api
2. 在 `/settings/skills` 增加 Skill Search 配置区
3. 实现本地搜索器
4. 实现 API 复判器
5. 新增 `skill_search` 工具并接入运行时
6. 精简系统提示词中的 skill 注入内容
7. 添加回归测试
8. 做一次最小真实验证：开关保存、工具返回、显式 skill 不回退、search 关闭时仍保持旧行为
