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
