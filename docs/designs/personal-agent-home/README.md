# Agent Handover 首页设计记录

后续工作首页采用 [UI 实施 Spec](../agent-home/personal-agent-dashboard-ui-spec.md) 中已确认的参考图与交互规则；本目录继续保留旧交接的方案记录，旧 HTML 不作为新首页实施目标。

状态：方案定稿并已实施（2026-10-23）；本目录保留讨论用原型。规则见 [PA-HD](../../requirements/personal-agent-experience-v1.md)，决策见 [ADR 0006](../../adr/0006-agent-handover-is-a-projection.md)，交付契约见 [交付 Spec](../agent-home/agent-handover-spec.md)，实施证据见[能力矩阵](../../requirements/personal-assistant-capability-matrix.md)。

本目录的三个 HTML 是讨论用的一次性原型，不是实现来源。它们只在浏览器里可看，数据是假的，也没有接真实接口；真正的实现要按规则表和 `DESIGN.md` 落地。

## 选中的方向

`c1.html`（对话流）的骨架：助手先开口 → 证据卡 → 待决定 → 输入框吸底。`c3.html` 的“现在”步骤流作为运行中区块的替代（不再画假截图）。

首屏顺序：

1. 小尺寸身份 + 状态（默认 Agent，不是 96px 大图）
2. 一句结论（完成了什么、几件等你决定），可展开到条目
3. 证据条目：完成（带产物/结果）、承诺兑现、失败汇总
4. 需要你决定（审批/选择题/等待运行），带来源 Agent 与源会话
5. 输入框（吸底，位置固定）
6. 最近对话 3 条（与交接去重）

安静日只保留 1 + 5 + 一行“今天接下来”；首次使用是身份 + 输入 + 起点；断连保留上次内容并标“未更新”。

## 被否掉的版本

| 文件 | 形态 | 否掉的原因 |
|---|---|---|
| `c2.html` | 证据卡片墙，无气泡 | 信息密度高但没有“助手在说话”的质感；单条证据可以借鉴它的卡片形态 |
| `c3.html` | 现在优先（运行态置顶） | 叙事顺序不如 c1；但它的步骤流比截图真实，已并入 c1 |
| 早期 A/B（已删除） | 安静入口 / 两栏工作台 | A 只是给旧首页加两条；B 是 Dashboard 形态，属于 PRD 明确排除的范围 |

## 每个区块的数据来源

| 区块 | 现有来源 | 实施结果 |
|---|---|---|
| 已完成条目 | `agent_trace_facts`（`run` 完成事实带 `agentId`、结束时间、`taskPreview`；`runtime_notice` 提供异常说明）与会话最后一条消息 | 已按任务执行优先、run 事实补足实现；默认展示最近 5 条并附交付内容预览（会话可读时）；失败只给一句模板原因 + 两行原始诊断；普通运行仍无步骤级进度，也不记录产物索引 |
| 承诺兑现 / 失约 | `event_execution_leases`（`finished_at`、`status`、`task_id`） | 已新增“自 T 起”查询；重试复用同一行，成功即折叠为一条“重试后完成” |
| 待决定：Host Bash | `GET /api/desktop/host-bash` 全局待审批 | 读模型直接读原始记录，在组装处解析 `sessionId` 与来源 Agent；只对 Web scope 提供就地批准/拒绝 |
| 待决定：Durable/Plan | `GET /api/desktop/durable-executions`、`/plans` | 读模型按等待状态合并；审批在交接内就地处理，Durable 审批带自己的审批行 ID 与执行版本，走既有工具审批桥接同时清理 Broker/Host Bash 记录与执行状态；Plan 首次批准提供两种模式 |
| 待决定：等待中的运行 | `GET /api/desktop/session-runs` | 已合并；与同一会话的审批/Plan 项去重 |
| 今天接下来 | Runtime Task 的 cron 文本 + Durable `next_run_at` | 已用与调度器相同的本地时间匹配器现算下次触发；不新增持久化字段 |
| “上次离开” | 无 | 已新增 `lastAcknowledgedAt` 与单份上一代快照，存于 Desktop 导航设置 |
| 产物预览 / 运行中步骤 | 图片/视频任务表；Durable projection | 仍在 V1 范围外：没有统一产物索引，普通运行没有步骤级进度 |

## 明确不做

- 永久主对话，或让交接可续聊
- Activity Feed、Dashboard、跨 Agent 活动流
- 模型判断 open loop
- 交接历史列表页（V1 只留最新与上一份）
- 浏览器截图/实时画面（没有浏览器自动化能力，不要画）

## 复看方式

在浏览器打开 `index.html`，顶部切换三版；右上角切明暗。（`home.css` 是共享样式，改一处三版同时变。）
