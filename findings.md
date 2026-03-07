# Findings & Decisions

## Requirements
- 当前 `runner.ts` 在主模型不支持图片时，发送图片会无法识别或乱回复。
- 目标是参考语音 fallback：先把不可直接消费的媒体转换成文本，再给主模型。
- 改动后仍需保留原生 vision 路由；只有在不支持原生图片时才走 fallback。
- 根据项目规则，完成后必须同步更新 `features.md` 和 `prd.md`。

## Research Findings
- `decideVisionRouting()` 目前只决定是否原生发送图片；fallback 仅仅是不传 `imageContents`。
- `enrichMessageTextWithAudio()` 已经实现了“读附件 → 调 STT → 转成文本注入 prompt”的完整链路。
- 当前非原生图片会被拼进 `<channel_attachments>`，这只能提供本地路径，主模型通常无法理解图片内容。
- 项目里已有 `visionModelKey` 与 `vision` capability/tag，可直接复用为图片分析模型来源。

## Implementation Notes
- 新增 `vision-fallback.ts`，风格对齐 `stt.ts`：负责 target 解析、请求、重试、错误信息。
- 在 `runner.ts` 里增加 `enrichMessageTextWithImages()`，返回增强后的文本和识别错误列表。
- fallback 注入文本格式采用结构化块，至少包含描述与可见文字，降低主模型歧义。
- 无可用 vision provider 时，给出明确 user notice，不再让主模型盲猜图片。
- 图片 fallback 优先复用 custom provider 的 `visionModelKey`，其次看 `textModelKey` 是否声明 `vision`，最后扫描其他可用 custom vision 模型。
- 提示词补充了 `[image analysis #N: ...]` 语义，避免拿到预处理文本后仍错误声称“看不到图片”。

## Open Questions
- vision fallback 请求优先走 OpenAI-compatible `/chat/completions`，是否已足够兼容当前自定义 provider 集合？
