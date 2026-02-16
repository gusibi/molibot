# Findings

## 2026-02-11
- 当前 custom provider 结构由单模型升级为多模型：`models[] + defaultModel + supportedRoles[]`。
- `/api/settings/provider-test` 已新增：先测连通性，再测 developer role 支持。
- Telegram mom stream 调用已加入角色兼容层：若 provider 不支持 developer，则将 context.messages 中 developer 角色映射为 system。
- Chat 首页模型切换已支持 custom provider 的多模型粒度（provider+model）。
- web build 失败原因仍是既有依赖浏览器外部化问题：`@smithy/node-http-handler` 导入 `stream.Readable`，与本次改动无直接关系。
