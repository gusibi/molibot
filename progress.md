# Progress

## 2026-02-28

- 创建计划文件，开始收集 prompt 架构与文档职责信息。
- 已完成示例项目、当前 runner、prompt 说明文档与 `/Users/gusi/.molibot` 现状对比，确认需要将系统级规则回收到代码、压缩 AGENTS.md 为行为规则文件，并补齐空的 profile 文件。
- 已完成代码重构：Telegram mom runtime system prompt 回收到 `runner.ts`，默认 `AGENTS.default.md` 改成 bootstrap 行为模板。
- 已更新仓库文档与记录文件，并完成 `npm run build` 验证通过。
- 已整理 `~/.molibot/AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`BOOTSTRAP.md`，按单一职责收紧内容。
- 已定位提醒失败根因：模型未触发工具调用，导致没有 event JSON 落盘。
- 已在 Telegram adapter 增加相对时间提醒的服务端 deterministic fallback，并再次通过 `npm run build` 验证。
- 已将 Telegram mom system prompt 拆成 section builders，降低 `runner.ts` 中单个超长模板的维护成本。
- 已加入启动时 prompt 预览落盘：每个 bot 工作区会生成 `SYSTEM_PROMPT.preview.md`，用于检查当前实际生效 prompt。
- 已修正 prompt 源目录解析：运行时现在固定从 `${DATA_DIR}`（当前为 `~/.molibot`）读取全局 `AGENTS.md` / `SOUL.md` / `TOOLS.md` / `IDENTITY.md` / `USER.md` / `BOOTSTRAP.md`，并支持大小写文件名兼容；预览头部会显示 `global_sources` / `workspace_sources` 便于核对。
- 已完成 `package/mory` 独立 SDK 化改造：增加包内 `NodeSqliteDriver` / `NodePgDriver`、开箱工厂函数、SQLite `embedding` 落库与本地 cosine rerank，并更新 README 与包清单。
