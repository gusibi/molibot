# Findings

## 2026-02-11
- 当前 custom provider 结构由单模型升级为多模型：`models[] + defaultModel + supportedRoles[]`。
- `/api/settings/provider-test` 已新增：先测连通性，再测 developer role 支持。
- Telegram mom stream 调用已加入角色兼容层：若 provider 不支持 developer，则将 context.messages 中 developer 角色映射为 system。
- Chat 首页模型切换已支持 custom provider 的多模型粒度（provider+model）。
- web build 失败原因仍是既有依赖浏览器外部化问题：`@smithy/node-http-handler` 导入 `stream.Readable`，与本次改动无直接关系。

## 2026-02-25
- Telegram 运行时原来只支持单 bot（`telegramBotToken` + `telegramAllowedChatIds`），且单 token 下 allowedChatIds 变更会被 `apply_noop_same_token` 忽略。
- 多 bot 改造需要同时覆盖三层：配置模型（`RuntimeSettings`）、运行时实例管理（每 bot 一个 `TelegramManager`）、设置页面（列表化编辑）。
- 为避免不同 bot 的同一 chat id 互相污染，bot 运行数据路径需隔离到 `<DATA_DIR>/moli-t/bots/<botId>`，会话索引 key 也要带上 bot 标识。
- 事件执行路径此前对 one-shot/immediate 强制直发，导致“任务指令型事件”无法交给 AI 执行。
- 通过新增可选字段 `delivery`（`text` / `agent`）可同时覆盖“字面提醒”和“任务执行”两类需求，并保持 JSON 结构简单。
- 当前代码已有“工作记忆文本读取”能力（Telegram mom），但 Web/统一路由尚无可编程 memory API。
- 最小可落地方案是两层架构：`memory gateway` 固定接口、`memory core` 插件化；先落地 JSON 文件 core，后续可替换向量库而不改 gateway/API。
- memory 开关最适合挂在全局 `settings.plugins.memory.enabled`，可通过 `/settings/plugins` 独立页面控制，避免污染 AI/Telegram 配置表单。
- 纯“关键词命中”会遗漏近义表达，采用 `keyword + recency` 混合评分可在不接入向量库前显著提升召回质量。
- `flush` 若每次全量遍历 session 历史会导致 O(N) 退化，按 `conversation cursor` 增量扫描可将常态成本降到 O(Δ)。
- 通过将结构化 memory 同步镜像到可读文本（`MEMORY.md` + `daily/YYYY-MM-DD.md`），可以提升运营可审计性并与 OpenClaw 的人类可读记忆习惯对齐。
- 仅靠“自动写入”仍会产生噪声，第二轮需要面向运营的人工治理面板（list/search/edit/delete/flush）来闭环。
- 冲突检测在无复杂 NLP 前可先采用 `factKey` 规则法（例如 name/preference/rule），已足够发现多数“同键不同值”问题。
- daily 记忆默认 TTL 能显著降低过时上下文污染；长期记忆保持无过期更符合跨会话稳定偏好存储。
- Telegram mom 原生 memory 路径此前散落在 workspace/chat 子目录（`${workspaceDir}/MEMORY.md`、`${workspaceDir}/${chatId}/MEMORY.md`），不利于统一治理。
- 通过统一到 `${DATA_DIR}/memory` 根目录并按 runtime/chat 建子路径，可同时满足“统一管理”和“环境隔离”两个目标。
- 若 Telegram agent 仍可通过通用文件工具直接编辑 memory 文件，则 gateway 仅是“旁路能力”；必须在工具层显式禁止 direct memory file 操作，才能保证 gateway 成为唯一契约层。
- “统一视图”不仅是页面聚合，还需要后台持续把文件型 memory 导入 gateway（冷数据回填 + 定时增量）才能稳定展示 bot 记忆。
