# 子代理 token 效率优化

日期：2026-10-08。状态：结构化交接与只读结果复用已实施并通过回归；单任务交接、外部写入/文件替换后的缓存失效、路径身份及显式刷新已修正；真实任务的 token/质量基线对比尚未测量。Issue tracker 未配置，发布及 `ready-for-agent` 标签待运行 `/setup-matt-pocock-skills` 后完成。

## Problem Statement

用户提交保存和发布内容的任务后，Agent 与子代理重复抓取、读取重叠内容、查看无关示例，并因工具参数错误重试。调用次数和模型轮次增加，已读内容不断进入后续请求，导致 Reply Usage、执行耗时与费用增长。用户希望减少不产生新信息的操作，同时保持产物质量、真实进度与发布验证。

一个已检查记录中，主 Agent 有 13 次工具调用；子代理有 51 次工具请求，包含失败请求，预算记录为 50 次。子代理运行约 8 分 28 秒、45 个模型轮次。完整双语文章和 15 张图片属于实际工作，不能将所有调用视为浪费。重复读取的存在已确认，但具体可节省比例与模型能力差异尚未测量。

## Solution

父 Agent 向子代理提供精简且完整的任务交接：目标、已有资料、相关路径、已确认约束、交付物与完成标准。子代理只补缺失信息，复用可靠结果，完成必要检查后返回产物和证据。父 Agent 验收委派结果，不重复从头探索。

在共享 Agent Runtime 评估并实现安全的只读结果复用与重复操作提示，防止同一执行持续重复获取未变化的信息。变化后的资料、新的读取范围和必要的失败修复仍可执行。对比同类任务的 Reply Usage、模型轮次、耗时和质量，以真实数据验证优化，而非仅减少工具计数。

## User Stories

1. As an owner, I want delegates to receive a clear goal, so that they avoid unrelated exploration.
2. As an owner, I want already acquired sources to be handed over, so that I do not pay for duplicate fetching.
3. As an owner, I want delegates to receive relevant verified constraints, so that they do not repeatedly discover the required format.
4. As an owner, I want only relevant context passed to delegates, so that delegation does not duplicate the entire conversation.
5. As an owner, I want explicit deliverables and completion criteria, so that delegates finish when the work is sufficient.
6. As an owner, I want missing information distinguished from known information, so that tools are used where they add value.
7. As an owner, I want truncated reads to continue from the unread range, so that previous ranges are not unnecessarily returned again.
8. As an owner, I want changed files to remain readable, so that result reuse does not hide edits.
9. As an owner, I want new file ranges to remain readable, so that result reuse does not prevent completing a long document.
10. As an owner, I want unchanged source results reused only when their validity is established, so that stale information does not affect the result.
11. As an owner, I want independent local checks batched, so that a separate model round is not required for each check.
12. As an owner, I want large outputs limited to relevant evidence, so that later requests do not accumulate unnecessary content.
13. As an owner, I want required tool parameters supplied correctly, so that validation failures do not waste retries.
14. As an owner, I want legitimate error correction to remain possible, so that efficiency controls do not stop recoverable work.
15. As an owner, I want writes and publishing excluded from result-reuse shortcuts, so that side effects are never silently skipped or replayed.
16. As an owner, I want the parent to inspect deliverables and validation evidence, so that delegation does not trigger another full exploration.
17. As an owner, I want permissions and approval boundaries preserved, so that efficiency changes do not expand delegate access.
18. As an owner, I want cancellation and recovery to retain completed work, so that stopping or restarting does not create duplicate effects.
19. As an owner, I want useful stage explanations preserved, so that reducing token consumption does not hide blockers.
20. As an owner, I want quality and total usage compared on equivalent tasks, so that a cheaper model is not selected solely by its token price.
21. As an owner, I want cumulative usage to stay accurate after compaction, so that context reduction is not presented as a refund of incurred usage.
22. As an owner, I want long-task classification to continue using the decision model, so that this optimization does not reintroduce keyword classification.

## Implementation Decisions

- Implement cross-channel behavior in the shared Agent Runtime and native parent/child delegation boundary. Channel adapters remain responsible for transport and platform conversion.
- Reuse the existing delegation task contract. Make goals, known material, missing information, constraints, outputs and acceptance criteria explicit in the model-facing handoff; do not introduce a second execution orchestrator.
- Existing phase-reporting and result-reuse prompt guidance is delivered. This spec covers enforcing and measuring efficiency beyond prompt advice; prompt wording alone is not proof of savings.
- Prefer references or targeted excerpts for large material. Never copy the entire parent Session automatically or broaden a delegate's authorization through supplied context.
- Use structured tool identity, normalized arguments, execution scope and source validity for repeat detection. This is separate from long-task classification; no natural-language keyword classifier is introduced.
- Begin with read-only operations whose identity and freshness can be proven. File reuse requires source-version and range awareness. Remote content is not assumed immutable; do not introduce generic URL memoization without a trustworthy validity contract.
- Reuse must provide useful prior content or an actionable existing-result reference. A bare “already read” rejection that forces the model to fetch again does not satisfy the requirement.
- Keep source-change invalidation, non-overlapping reads, explicit refresh and error correction possible. Do not prohibit all second reads of a path.
- Never cache writes, edits, publishing or approval decisions as if they were reads. Continue using existing native execution receipts and recovery rules for side effects.
- Keep temporary duplicate-operation guidance outside ordinary Session messages. It must not contaminate later turns, reloads or unrelated tasks.
- Preserve Pi-owned committed execution as the source of truth. Do not introduce a second writable execution ledger or depend on private third-party checkpoint JSON.
- Prefer existing trace and usage projections for measurement. Track model rounds, tool requests, repeat/overlap evidence, retries, reported input/output/cache tokens, cost when available, elapsed time and completion quality. Do not report inferred cost as actual cost.
- Do not impose a new fixed turn limit, silently change models or add new user settings. Respect current budgets, authorization and model selection.

## Testing Decisions

- The owner confirmed the existing shared Agent Runtime parent/child delegation boundary as the primary seam. Use temporary workspaces, isolated stores, injectable ownership and controlled model responses; never acquire the live user's service ownership for a test.
- Test observable requests, tool effects, deliverables and result receipts rather than private implementation structure or exact prompt prose alone.
- Verify that actual child model requests receive the known source, constraints and completion criteria without an unrelated parent-history dump.
- Cover repeated unchanged file reads, overlapping and non-overlapping ranges, truncation continuation, edits followed by rereads, distinct scopes and unavailable prior results. Check both useful returned evidence and physical read behavior where reuse is enabled.
- Cover recoverable parameter errors and execution errors. A failed operation must not produce a successful reusable result.
- Verify that writes and publishing are not skipped or replayed by efficiency logic; cancellation, approvals and recovery retain the existing ownership contract.
- Prefer existing native child execution, Runner, tool runtime and usage-projection test patterns. Add lower-level tests only where the primary seam cannot make the failure deterministic.
- Compare the same representative tasks, source material, model settings and quality criteria before and after optimization. Use controlled models for correctness and real-model repetitions for efficiency; distinguish them in the report.
- Include short content, long content and image-heavy content. Accept efficiency gains only when deliverables and validation remain correct; fewer calls alone is insufficient. Record total Reply Usage, cache usage, model rounds, elapsed time and outcome. Do not set an unsupported savings percentage before a baseline exists.

## Out of Scope

- Replacing decision-model long-task classification with keywords.
- Changing default models, provider pricing or user cost authorization.
- A content-publication-specific orchestrator or a new parallel task scheduler.
- Caching side effects, bypassing approvals, or suppressing valid refreshes and retries.
- Replacing native compaction, creating another writable execution store, or modifying third-party kernel internals.
- Another progress UI redesign, new settings screens or a separate analytics dashboard.
- Replaying or republishing the user's historical Session as part of automated testing.

## Further Notes

The readable progress display and prompt reuse guidance have been committed. The runtime reuses identical text reads using file identity and nanosecond modification/change times, checks the version before and after reading, and supports `refresh: true`. Measurable token savings remain unverified.

The read tool already reports the next offset after truncation. Repeated overlapping reads therefore cannot be attributed solely to missing continuation information. Better handoff, model behavior and runtime reuse must be evaluated together.

The current native child execution and private execution-storage ADR remain authoritative. This spec supplements their efficiency requirements and does not supersede the durable execution, large autonomous execution or permission plans.

Publication is authorized through the invoked to-spec skill, but the project issue tracker and label vocabulary have not been configured. Once configured, publish this spec and apply `ready-for-agent` without an additional interview.
