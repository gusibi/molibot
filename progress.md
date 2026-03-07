# Progress Log

## 2026-03-06
- 初始化任务规划文件，明确目标为“图片 fallback 与语音 fallback 对齐”。
- 已完成 runner 中图片/语音链路对比，确认图片当前缺少真正的“转文本”环节。
- 已新增 `src/lib/server/agent/vision-fallback.ts`，并把图片分析 fallback 接入 `src/lib/server/agent/runner.ts`。
- 已同步更新日志观测与系统提示词，让 `[image analysis #N: ...]` 作为可直接推理的输入。
- 文档已更新：`features.md` 记录实现能力与变更日志，`prd.md` 新增交付项 `P1-71`。
- 遇到一次 `features.md` 更新日志补丁上下文未命中，已通过重新读取目标区段后修复。
- 已执行 `npm install` 补齐本 worktree 缺失依赖；随后执行 `npm run build`，构建通过。
- 构建过程中仅出现既有的 Node SQLite experimental warning 与若干 TypeBox circular dependency warning，本次改动未引入新的构建失败。

## 2026-03-07
- 通过检查 `/Users/gusi/.molibot/moli-t/bots/molipi_bot/7706709760/contexts/s-mmdo7f94.json` 确认根因：当前用户消息已经包含 `[image analysis #1: ...]` 文本，但同一 session 历史里仍残留 `type:"image"` 的 `toolResult`，导致后续文本模型请求继续携带 image content 并报 `400 Model do not support image input`。
- 已修复 `src/lib/server/agent/runner.ts`：custom model 的 `input` 能力不再默认伪装成支持 image；发送到 `streamSimple()` 前会为 text-only model 清理上下文中的历史 image parts。
- 下一步：重新触发一次相同 session 或新 session 图片问答，确认不再出现同类 400。
