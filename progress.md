# Progress

## 2026-03-03
- 启动复杂任务的文件化计划。
- 已读取技能说明、`features.md`、`prd.md`。
- 已确认当前目录语义：`moli-t` / `moli-f` 是 channel runtime，不是 agent 层。
- 下一步：继续定位 settings schema、prompt 加载实现和 bot 工作区路径生成逻辑。
- 已完成 settings schema 扩展：新增 `agents` 与 bot `agentId` 关联字段，并加入 agent/bot profile 文件读写 API。
- 已完成 `/settings/agents` 页面，以及 Telegram/Feishu bot 页面中的 agent 选择和 bot 级 Markdown 编辑。
- 已完成 runtime prompt 分层加载与 preview 来源展示调整，顺序为 `global -> agent -> bot`。
- 已移除 `prompt.ts` 中硬编码的 `Voldemomo` 身份句，核心 system prompt 现在保持中性，agent 身份改由 `IDENTITY.md` / `SOUL.md` 决定。
- 已完成第二阶段 vision 路由：`runner.ts` 现在会根据 custom model 的 `vision` verification 决定是否发送 native image payload，否则降级为附件式处理。
- 已完成 `audio_input` 配置层铺设：settings schema、sanitize、provider test、providers UI 均已支持该标签，但运行时仍保持 STT 路径，等待后续 native audio transport 能力。
