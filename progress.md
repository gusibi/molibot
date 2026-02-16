# Progress

## 2026-02-11
- 完成 `CustomProviderConfig` 数据结构升级（多模型 + 角色能力）。
- 完成 settings 读写层兼容迁移（旧 `model` 自动兼容）。
- 新增 Provider 测试 API：`POST /api/settings/provider-test`。
- 重构 `/settings/ai` 为双栏布局：左侧可搜索 provider 列表，右侧 provider 详情编辑。
- 右侧详情支持：字段编辑、多模型增删、默认模型、支持角色展示、Provider 测试。
- 实现 Telegram pi 调用 developer 角色不兼容兜底映射。
- 验证：`npm run build` 通过；`npm --prefix web run build` 仍因既有依赖打包问题失败（`@smithy/node-http-handler` browser externalization）。
