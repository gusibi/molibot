# Findings

## 2026-03-03
- 当前设置页已有独立的 Telegram/Feishu bot 页面，数据来源是 `settings.channels.<channel>.instances[]`。
- 当前 `RuntimeSettings` 里没有 `agent` 概念，bot 实例结构也没有 `agentId` 字段。
- 当前 prompt preview 显示 `global_sources` 包含 `~/.molibot/USER.md` 等全局文件，`workspace_sources` 为空，说明还没有 agent/bot 覆盖层。
- bot 工作区已经存在 `SYSTEM_PROMPT.preview.md`，适合作为改造后的验证点。
- 现有 bot 目录已经天然适合放 bot 级覆盖文件，但 agent 应新增为数据根目录下的独立目录，而不是放进 channel 目录。
- 第二阶段 vision 路由已经明确：主 text 模型若 `vision` 已声明且验证通过，则直传图片；否则才尝试 dedicated vision route；再不满足就降级为附件路径，不发送 native image payload。
