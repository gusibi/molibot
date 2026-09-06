# Session 管理：批量清理、自动归档与信息提炼

日期：2026-09-05

文档状态：草案；待确认 Testing Decisions 中的测试边界后发布 issue。本文定义待实现行为，不声明功能已交付。

## Problem Statement

随着 BOT 和日常使用增加，用户积累了大量 Session。一次性问答、已完成讨论和长期工作混在日常会话列表中，寻找当前工作越来越困难。逐个打开、判断、删除成本高，也缺少按 BOT、时间批量处理的入口。

部分一次性会话包含值得保留的偏好、事实、项目决定或成果。用户希望保留这些价值后清理会话，但无法判断哪些信息已经保存、哪些仍只存在于原对话中。

现有系统具有单会话删除、外部会话 BOT 身份投影和记忆反思能力，尚未形成覆盖列表管理、归档、删除恢复和主动提炼的完整生命周期。

## Solution

提供独立的「会话管理」页面，统一展示用户有权管理的本地、BOT 渠道和 Project 会话。用户可搜索、筛选、预览并批量操作；日常侧栏仅显示未归档、未删除的会话。

分两个可独立验收的阶段实现：

1. **基础管理**：管理页面、筛选与多选、归档与恢复、长期保留标记、删除与回收站、自动归档策略。完整覆盖多 BOT 和跨渠道生命周期，不按渠道分批堆积特判。
2. **保留价值后清理**：按 Session 主动提炼、保存结果与处理进度、查看关联记忆和成果、提炼后归档及对应快捷筛选。第一阶段不显示尚未实现的提炼按钮或虚假完成状态。

归档保留完整会话并减少列表干扰。删除先进入回收站，30 天后清除。提炼后归档只有在所选内容处理成功且需要保留的结果已实际保存后才执行；提炼不触发自动删除。

本文采用讨论中的建议默认值：自动归档初始关闭，启用后默认 30 天无对话活动，每天检查一次；回收站保留 30 天。它们是本 spec 的产品默认值，不是现有系统事实。

## User Stories

1. As a Molibot owner, I want a dedicated Session management page, so that I can manage accumulated conversations without opening them individually.
2. As a Molibot owner, I want to see all conversations I am authorized to manage, so that cleanup is not limited to one channel.
3. As a Molibot owner, I want to filter by one or more BOT instances, so that I can clean up a particular assistant's conversations.
4. As a Molibot owner, I want local and Project conversations to have clear source identities, so that conversations without a BOT remain discoverable.
5. As a Molibot owner, I want to search titles and eligible conversation content, so that I can find a topic before deciding what to keep.
6. As a Molibot owner, I want to filter by last conversation activity, so that old but actively used conversations are not mistaken for abandoned ones.
7. As a Molibot owner, I want inactivity presets and a custom date range, so that routine and precise cleanup are both convenient.
8. As a Molibot owner, I want separate active, archived and trash views, so that I understand where each conversation has gone.
9. As a Molibot owner, I want titles, sources, activity dates and conversation lengths in the list, so that I can make quick decisions.
10. As a Molibot owner, I want an adjacent transcript preview that preserves filters and selection, so that I can inspect many conversations efficiently.
11. As a Molibot owner, I want to select individual rows and all rows on the current page, so that I can control the exact batch.
12. As a Molibot owner, I want to explicitly select all matching results across pages, so that large cleanup does not require repetitive paging.
13. As a Molibot owner, I want to see the selected count and operation consequences, so that I know what a bulk action will affect.
14. As a Molibot owner, I want to archive multiple conversations at once, so that my daily list reflects current work.
15. As a Molibot owner, I want to restore archived conversations, so that archiving remains reversible.
16. As a Molibot owner, I want archived conversations to remain searchable under existing access rules, so that I can recover old information.
17. As a Molibot owner, I want reading an archived conversation to leave it archived, so that inspection does not clutter the daily list.
18. As a Molibot owner, I want a new message to resume the correct archived conversation, so that channel continuity does not create duplicate Sessions.
19. As a Molibot owner, I want to mark important conversations for long-term retention, so that automatic cleanup leaves them alone.
20. As a Molibot owner, I want to move multiple conversations to trash, so that I can remove disposable conversations with a recovery period.
21. As a Molibot owner, I want to restore trashed conversations before expiration, so that an accidental deletion is recoverable.
22. As a Molibot owner, I want to know when trash will be cleared, so that I understand the recovery deadline.
23. As a Molibot owner, I want saved memories and independently saved artifacts to survive Session deletion, so that deleting a conversation does not erase separate assets.
24. As a Molibot owner, I want active work and pending approvals to block destructive cleanup, so that management does not interrupt ongoing execution.
25. As a Molibot owner, I want individual success, skipped and failure results with retry, so that one failed item does not obscure the rest of a batch.
26. As a Molibot owner, I want automatic archiving to be opt-in with an affected-count preview, so that enabling it is predictable.
27. As a Molibot owner, I want BOT-specific inactivity settings that inherit a global default, so that different assistants can have different retention needs.
28. As a Molibot owner, I want policy settings and lifecycle states to survive restart, so that cleanup remains reliable between application runs.
29. As a Molibot owner, I want empty and short-conversation filters, so that I can quickly review likely disposable conversations without the system assuming they are worthless.
30. As a Molibot owner, I want bilingual, responsive management controls with light and dark themes, so that the feature fits the rest of the application.
31. As a Molibot owner, I want to extract useful information from selected Sessions, so that valuable knowledge does not depend on keeping every conversation active.
32. As a Molibot owner, I want preferences, project decisions and complete artifacts to keep their appropriate destinations, so that summarization does not replace the actual work product.
33. As a Molibot owner, I want to see saved results, nothing-to-save results, pending review and failures separately, so that I can judge whether processing finished.
34. As a Molibot owner, I want extraction progress to identify the processed message range, so that new messages are not hidden by an old completion marker.
35. As a Molibot owner, I want extraction to respect turn retention and memory deletion rules, so that cleanup cannot reintroduce information I prohibited or removed.
36. As a Molibot owner, I want extraction retries to avoid duplicate memories and artifacts, so that retrying a failed batch is safe.
37. As a Molibot owner, I want successfully processed Sessions to be archived, so that retaining their useful information also reduces list clutter.
38. As a Molibot owner, I want a processed-but-not-archived filter and links to retained information, so that I can review remaining cleanup work.

## Implementation Decisions

### Domain and scope

- Follow the domain glossary: **UI Session** is the user-facing conversation view; **Agent Context** is model-facing continuation state. Lifecycle actions coordinate both instead of merely hiding a UI row.
- Distinguish BOT instance, Channel and Project identity. Display names are labels, not authorization keys. Historical records without a resolvable BOT remain visible as an unknown source, never guessed into another BOT.
- Manage ordinary user-facing local, external-channel and Project conversations. Exclude internal event/approval conversations and execution-attempt records from ordinary cleanup inventory. Runtime Tasks and Durable Executions remain separate aggregates; Session deletion does not delete or cancel them.
- User authorization is rechecked by the shared service for every query and operation. No client-supplied BOT, owner, Project or Session identifier grants access by itself.

### Shared lifecycle and persistence

- Place querying, lifecycle operations, eligibility, batch coordination and automation in the shared application layer. Channel adapters only translate and transport messages; they do not own cleanup policies.
- Extend the existing lifecycle pattern that coordinates Session data, Agent Context and runner state. Replace entrypoints that would bypass recoverable deletion, rather than keeping inconsistent old deletion semantics.
- Persist lifecycle state as active, archived or trashed, with explicit timestamps, last conversation activity, long-term retention flag and concurrency version. Track the pre-trash state so restore returns to active or archived as appropriate.
- In accordance with the accepted per-domain persistence ADR, queried lifecycle and concurrency fields live as database columns in the Session-owned state store. Do not create an independent settings-based or JSON-file lifecycle index. Existing transcript content need not be rewritten as part of this feature.
- Cross-store cleanup uses persisted intent and completion state, retryable idempotent steps and startup reconciliation. Do not assume a transaction spans Sessions, Agent Context, search, memory and artifacts.
- Last conversation activity advances for accepted conversational messages and visible assistant replies. Opening a conversation, renaming it, indexing it, extracting information or updating lifecycle metadata does not advance it. Resolve older conversations from existing message evidence without fabricating a recent activity date.

### Page, query and bulk operations

- Add a management entry to the conversation area. Default to active Sessions, ordered by last conversation activity descending, with a stable identity tie-breaker. Provide archived and trash views with counts.
- Offer multi-BOT filtering, explicit local/Project source filtering, keyword search, inactivity thresholds of 7/30/90 days and a custom activity-date range. Interpret date ranges in the user's configured timezone and use unambiguous boundaries in queries.
- Apply search through existing authorized conversation search projections and Turn Retention Policy. Direct authorized transcript preview does not make restricted content searchable.
- Display title, BOT/source, last conversation activity, user-turn count and applicable lifecycle/protection status. Phase two adds extraction status. Define empty as no user or assistant messages; define short as one or two user turns, excluding empty Sessions.
- Use server-side pagination and counts. List rendering must not load every full transcript. Load the selected preview on demand; preserve filters, scroll and selection when the preview closes.
- Distinguish current-page selection from all matching results. Changing filters clears selection. All-results selection captures the matching identities and versions at selection time; later arrivals are not silently added. Eligibility and ownership are checked again when the action executes.
- Bulk requests identify an operation and either explicit selected targets or a server-issued selection reference, plus an operation idempotency key. Return an operation identity, counts and per-item outcomes. Large operations expose durable progress that remains readable after reconnect.
- Provide fixed bulk controls for archive, restore and delete, plus phase-two extract-and-archive. Before deletion show the exact count, recovery period and data scope. Restore actions only apply to the relevant archived/trash view.
- Each item reports succeeded, skipped or failed with an actionable reason. Retry only failed items; already-completed actions remain idempotent. Recheck changes since selection, and skip recently changed targets rather than act on stale preview assumptions.
- Follow the shared design system, existing shadcn-svelte components, semantic CSS and explicit Svelte reactive state. Support keyboard selection and labeled controls, narrow layouts, instant Chinese/English switching and light/dark themes. Policy saves use the existing fixed settings footer.

### Archive, protection and incoming messages

- Archiving removes a Session from ordinary sidebars but retains transcript, Agent Context and authorized searchability. Archive does not relax retention rules or alter existing cross-conversation retrieval eligibility.
- Viewing archived content does not restore it. Explicit restore or an accepted new message for the same authorized conversation restores it to active. Concurrent restore/message handling must converge on one Session identity.
- Long-term retention exempts a Session from automatic archiving. Explicit manual archive remains possible. Deletion requires removing the protection marker first; bulk results identify protected Sessions as skipped.
- Running work, queued work, pending approvals and nonterminal linked Runtime Tasks or Durable Executions block archive and deletion. The shared runtime coordinates admission and lifecycle mutation so a check followed by a concurrent message cannot lose work. Cleanup never implicitly cancels work.
- Trashed Sessions cannot resume. Detach their active routing binding; subsequent external messages use the existing new-conversation path. Explicitly restoring an older trashed Session does not replace a newer active channel binding.

### Delete, restore and cleanup scope

- Delete moves a Session to trash for a fixed 30-day recovery period. Hide it from ordinary lists and remove its conversation search projection immediately. Exclude it from new Agent Context continuation and reflection/extraction inputs.
- Retain the Session-owned data required for full restore during that period. Restore reinstates eligible search entries and the previous lifecycle state, without republishing messages or replaying tools. Reevaluate current runtime constraints rather than reviving obsolete approvals.
- After expiration, the runtime clears Session-owned UI metadata, Agent Context and exclusively owned conversation artifacts, and finalizes search deletion. Failures remain recoverable cleanup work; a partial failure must not resurrect a deleted Session.
- Saved memories, independent documents, Project root files and shared artifacts are separate targets and are not deleted by this action. Keep referenced artifacts while a live independent owner requires them; never infer exclusive ownership from a filesystem location alone.
- Linked memory and evidence views return an explicit source-unavailable state when the source has been purged. They do not crash or imply the saved memory or completed work has failed.
- The delete confirmation states that saved memories and independent artifacts are retained. Provide a link to inspect associated retained items; deleting those requires their existing explicit target-specific operation.

### Automatic policy

- Automatic archive is off initially. When enabled, default to 30 elapsed days without conversation activity. Allow a positive whole-day threshold globally and a per-BOT choice of inherit, disabled or custom threshold. Local and Project Sessions inherit the global policy in this version.
- Policy editing previews how many Sessions currently qualify. Saving changes does not immediately mutate the previewed Sessions; the next scheduled sweep applies fresh checks. Changing the threshold does not automatically restore previously archived Sessions.
- Run one daily maintenance sweep through watched-event JSON and the existing Runtime Event dispatcher. Do not use an OS scheduler, memory note or per-Channel timer. The maintenance trigger must not create ordinary user-visible Sessions.
- Use the same eligibility and mutation service for manual and automatic archive. The sweep skips active work, protected Sessions, trashed Sessions and already-archived Sessions. Concurrent or replayed sweeps must converge without duplicate work.
- Persist maintenance progress and recovery information in the owning runtime/state stores. After downtime, reconcile unfinished work and resume through the runtime without replaying one sweep per missed day.
- The automatic archive switch controls only archiving. Expired trash cleanup remains governed by the deletion deadline already shown to the user.
- Save global and per-BOT policies through fine-grained settings operations. Saving one BOT's policy must not overwrite other BOT, provider or model settings. Show last maintenance result in management; no repetitive per-Session notifications.

### Phase two: extract and archive

- Reuse the memory gateway, reflection source reader, validation and duplicate-suppression behavior. Add explicit Session/range processing rather than treating a previous daily reflection run as proof that an entire Session was processed.
- At job start capture the authorized source identity and message revision. Record processed-through progress and saved result references durably. Later messages make the Session partially processed again.
- Stable preferences and facts enter the appropriate Memory Namespace. Project facts and decisions remain Project-scoped. Respect the existing approval/review policy for candidates; pending candidates are not equivalent to saved memories.
- Link complete independently saved artifacts rather than replacing them with a memory summary. If a result exists only in the transcript and needs preservation, save an authorized independent document before claiming preservation; reuse existing artifact/document capabilities and do not invent a new knowledge repository.
- Display unprocessed, processing, saved, no useful information, pending review, partially processed and failed outcomes as appropriate. Associate each result with the exact source range. An empty model response or malformed result is not automatically proof that nothing was worth saving.
- Respect canonical Turn Retention Policy across all source entries. Restricted turns cannot be promoted into durable memory or extracted documents by this workflow. Explicit existing user-directed file operations retain their separate semantics. Honor memory deletion suppression so cleanup cannot recreate a forgotten item.
- Persist extraction result receipts with source/range identity so retry does not duplicate previously saved memory or artifacts. A failed sibling result must not erase already-saved results or falsely complete the entire Session.
- Extract-and-archive archives only after all selected eligible content is processed, required outputs are saved, no candidate is awaiting review, and the source version is unchanged. A successful no-useful-information result may archive. Concurrent messages, failed saving or pending review leave the Session unarchived with a clear result.
- Existing manual archive remains available regardless of extraction state. Extraction is not a prerequisite for ordinary manual or automatic archive, and successful extraction never triggers deletion.

## Testing Decisions

- **Primary test boundary, awaiting user confirmation:** the shared application-level Session management service used by UI APIs, inbound lifecycle handling and runtime maintenance. Prefer extending the existing dependency-injected lifecycle entry over exposing new low-level test-only helpers. Exercise real temporary Session/Agent/search persistence and a controllable clock, with controlled runtime and model collaborators.
- Assert observable outcomes: which Sessions appear, which content remains searchable, which conversation receives a new message, which data survives restore/restart, and which batch results the caller receives. Do not assert internal helper calls, private table layouts or implementation-mirroring snapshots.
- Existing prior art includes Web Session lifecycle tests coordinating UI and Agent deletion and rejecting wrong owners/running sessions; conversation search and retention tests; external BOT grouping tests; memory reflection validation/progress tests; runtime event and lease recovery tests; and desktop chat integration tests.
- Main lifecycle scenarios cover filtering, cross-owner/BOT isolation, pagination and all-results selection, protected and busy targets, stale selections, partial batch failures, retries, archive/search/restore behavior, new-message races, trash restore, expiry, crash between stores and startup reconciliation. Preserve saved memory and shared/independent artifacts while deleting eligible Session-owned data.
- Automatic-policy scenarios use fixed time and timezone boundaries to cover exact thresholds, metadata-only changes, empty Sessions, global inheritance, per-BOT disable/override, restart and overlapping/replayed sweeps. Verify scheduled and manual operations apply the same eligibility rules.
- Settings acceptance includes whole-object save → new store instance → load round-trip against a temporary database, verifying all supported settings remain unchanged outside the edited policy.
- Phase-two scenarios use deterministic extraction responses to verify namespace and retention rules, no-useful-information results, malformed output, pending review, failed artifact saving, partial success, duplicate suppression, newly arriving messages, previously deleted memory suppression and source-unavailable rendering after purge.
- Keep a small real UI acceptance suite for filter changes, reactive multi-selection, cross-page selection counts, preview state preservation, fixed action controls, loading/error/retry behavior, Chinese/English, light/dark and mobile width. API adapter checks cover authentication, request validation and per-item result projection.
- Required delivery verification includes relevant tests, svelte-check and build, plus isolated cold-start smoke: restart service → first open management → select/preview/action → switch Session/page → interrupt and restore service → confirm state, policy and operation recovery. Never start test services against production BOT credentials.
- All persistence tests and smoke data use temporary databases, temporary workspaces and injected stores; never touch the user's live settings, queues, Sessions, event leases or Project files.

## Out of Scope

- Automatic deletion of active or archived Sessions based on age or an AI value judgment. Expiration cleanup of explicitly deleted trash is in scope.
- Treating a short conversation or successful extraction as proof that its original transcript is safe to destroy.
- Immediate permanent-delete and empty-trash shortcuts; the first version uses the fixed recovery period.
- New folder hierarchies, custom tagging systems, arbitrary rule builders or AI cleanup scoring.
- Deleting or canceling Runtime Tasks, Durable Executions, provider/BOT settings, remote platform messages, saved memories or Project root files through Session deletion.
- Changing model context compaction, ordinary memory injection, memory review policy or the canonical Turn Retention Policy.
- A new knowledge-base product, automatic task creation from extracted notes, new artifact editors or new external channels.
- Rebuilding the entire historical transcript storage system, backward-compatibility layers, or unrelated documentation/code cleanup.
- Implementing phase-two controls as placeholders in phase one.

## Further Notes

- Product choices inherited from discussion are the 30-day archive default, 30-day trash recovery, daily runtime maintenance, per-BOT overrides and two-stage delivery. No production cleanup or policy activation is authorized by creating this spec.
- The existing glossary's Delete semantics and accepted memory/retention and per-domain persistence ADRs constrain this design. Recoverable trash adds a recovery interval while preserving target-specific, non-cascading deletion and immediate search exclusion.
- This spec owns Session lifecycle requirements. Existing artifact inspection and memory usage/feedback documents retain their separate responsibilities; no predecessor is superseded by merely adding management and retention behavior.
- Phase one is independently useful and must pass its complete acceptance set before adding phase two. Phase two is a separate delivery milestone within this spec, not a dependency that blocks basic management.
- Publication target: the repository's GitHub issue tracker, with the existing `ready-for-agent` label after the testing-boundary confirmation required by the invoked skill. Publishing a spec is not a claim that either phase is implemented.
