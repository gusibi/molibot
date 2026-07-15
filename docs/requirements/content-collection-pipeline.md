# 内容采集与成长日志管线（Content Collection Pipeline)

> 日期：2026-07-10
> 来源：从 `memory-improvement-plan.md` v2 拆出（原 T8）。记忆 MVP 不依赖本文档；本文档服务于魔魔计划的「每日信息扫描 → 内容素材」链路（见 `market/定位.md`）。
> 后续「内容生成 / 审核 / 发布记录」管线任务（原缺口分析中的 T9 内容生产管线）确定需求后也归入本文档。

## P-1 [P1] Subagent 信息采集能力（collector 角色 + 联网工具面 + 自定义角色）

（编号沿用原清单 T8，内容一致。）

**现状问题**：subagent 基础设施已经成熟——隔离会话（in-memory session，跑完 dispose）、预算守卫 + 独立 deadline 定时器、模型分级路由与降级链、single/parallel/chain 三种编排、审批穿透、结果压缩 ≤6000 字符回传（`src/lib/server/agent/tools/subagent.ts`、`subagentRuntime.ts`）；定时事件也已支持 `delivery: "agent"` + `sessionMode: "fresh"`（每次触发开全新会话，`src/lib/server/agent/events.ts`），且 `subagent` 是主 run 的核心工具（`tools/index.ts:589`），system prompt 主动引导委派。**但它是为写代码设计的**：

- 子会话工具面只有 read / bash（worker 另有 edit / write），创建时显式 `noSkills: true` / `noExtensions: true`，**没有 webSearch、没有网页抓取、没有 MCP**（`subagent.ts:799` DefaultResourceLoader、`subagent.ts:719` createCustomTools）。
- scout 的只读 bash 白名单（`subagent.ts:133`）不含 curl，完全出不了网。
- 五个内置角色（scout / planner / worker / reviewer / skill-drafter）是编码流水线；`SUBAGENT_NAMES` 硬编码（`subagent.ts:49`），不支持从 workspace 加载自定义角色——与「Bot 即文件」理念不一致。

**为什么要改**：魔魔计划的每日信息扫描（主题追踪、新闻、互联网旅行素材）是上下文消耗大户。现在这类任务只能由主 run 自己调 webSearch、自己吞下全部网页内容——恰好是上下文膨胀的最坏模式。正确形态是主 run 只做编排，采集与消化隔离在 subagent 的独立上下文里，只回传摘要。

**改进目标**：

1. **工具授权机制**：角色 frontmatter 的 `tools` 字段支持声明 `webSearch` / `webFetch`（网页抓取 + 正文提取），运行时按声明注入（webSearch 复用主 run 的 `createWebSearchTool`；抓取工具复用 search 基建或新建轻量 fetch 工具）。未声明的角色保持现有最小工具面。
2. **新增内置 `collector` 角色**：职责为「搜索 → 抓取 → 消化 → 把完整素材写入 artifact 文件 → 只回传要点摘要」；默认模型等级 haiku 或 sonnet；提示词强调输出结构化摘要（来源 URL、要点、可信度、值得深挖的线索）。
3. **自定义角色加载**：从 bot workspace（建议 `<workspaceDir>/subagents/*.md`）加载用户定义角色，与内置注册表合并；frontmatter 格式沿用（name / description / tools / model）；未知工具名忽略并写告警日志。
4. **编排指引**：system prompt 的 subagent 指南补充定时扫描推荐模式——fresh session + parallel collectors + artifact 文件传递（大素材走文件，父上下文只接摘要）。

**验收标准**：

- 一个 `sessionMode: "fresh"` 的定时任务中，主 run 并行派 2 个 collector 扫描不同主题，各自的 artifact 摘要文件落盘，主 run 读文件汇总；collector 抓取的原始网页内容不进入父上下文（仅 ≤6000 字符摘要回传）。
- workspace 自定义角色（含 `tools: webSearch`）能被列出并执行；删除文件后回退到内置角色。
- 无搜索 API key 时 collector 优雅降级（报告 blocker 而非报错挂死，预算守卫照常生效）。

**依赖**：无硬依赖；与记忆清单的 T3（扫描产物进记忆管线）、T6b（内容记忆）组合后形成每日扫描闭环。涉及外网工具授权与子代理上下文边界，实现时安全策略需单独评审。
