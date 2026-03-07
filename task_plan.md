# Task Plan: 图片 fallback 与语音 fallback 对齐

## Goal
为 runner 增加图片转文本 fallback，让不支持原生图片输入的主模型在收到图片时也能稳定理解内容，而不是只看到附件路径。

## Current Phase
Phase 5

## Phases
### Phase 1: Requirements & Discovery
- [x] 理解用户目标：图片 fallback 参考语音 fallback
- [x] 对比 runner 中图片与语音处理链路
- [x] 记录关键差异与实现方向
- **Status:** complete

### Phase 2: Planning & Structure
- [x] 确定最小实现：新增 vision-to-text fallback 模块
- [x] 确认受影响文件与文档更新点
- [x] 记录接口与错误处理策略
- **Status:** complete

### Phase 3: Implementation
- [x] 实现 vision fallback provider 调用
- [x] 在 runner 中接入图片文本增强流程
- [x] 保持原生 vision 路由不受影响
- **Status:** complete

### Phase 4: Testing & Verification
- [x] 执行最小范围构建或类型验证
- [x] 记录验证结果
- [x] 修复发现的问题
- **Status:** complete

### Phase 5: Delivery
- [x] 更新 `features.md`
- [x] 更新 `prd.md`
- [x] 总结实现与后续建议
- **Status:** complete

## Key Questions
1. 复用现有 vision route 作为图片转文本 fallback，是否足够覆盖现有配置？
2. fallback 文本应该包含哪些结构，才能兼顾 OCR 与场景理解？
3. 当没有 vision provider 时，怎样降级才不会诱导主模型胡猜？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 图片 fallback 采用“先 vision 分析成文本，再交给主模型” | 与语音 STT fallback 同构，最稳定 |
| 优先复用现有 `visionModelKey` / vision provider 解析能力 | 最小改动，不新增设置面板复杂度 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `features.md` 更新日志补丁上下文未命中 | 1 | 重新读取 `## Update Log` 附近内容后按实际文本补丁 |

## Notes
- 每完成一个阶段同步更新文档
- 不让文本模型直接对附件路径猜图
