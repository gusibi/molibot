# Multi-Agent Room Spec

状态：实现已落地，待原生 Desktop 验收。V1 限定桌面 App；验收记录见 `prd.md` 的 issue #62 条目。本文保留完整需求口径。

## Problem Statement

Molibot 的普通对话以一个 Agent Context 继续单个 Agent 的对话。用户无法在一个长期可见的聊天室中邀请多个已配置 Agent、保留各自的身份和上下文、比较多方回答，再持续追问某一位 Agent。

简单地把多个 Agent 的回答放进同一个 Agent Context，会混合工具历史和身份；让多个 Agent 并发写入同一聊天室上下文，也无法可靠地维护各自的连续性和消息归属。用户需要一个共享可见记录，同时让每个参与者拥有独立 Agent Context 的房间。

## Solution

Agent Room 长期保存团队与工作范围，包含多次 Room Session。每次会话分别保存带作者归属的共享记录，以及每个成员各自独立的 Agent Context。新建会话保留房间配置，开启空聊天和新成员上下文；历史会话可切回继续。成员使用现有配置的 Agent；上下文按房间、会话、成员隔离。

V1 在桌面 App 中创建普通或 Project 房间。没有提及目标时，Primary Agent 回答；回复某个成员的消息时由该成员继续；显式 `@` 指定目标并优先于回复对象。多个 `@` 并行进行受限的只读讨论，需要实际操作时用户另行指定一个成员执行。

同一房间内所有成员的写入能力 Run 串行执行；等待审批的 Run 保留该房间的执行资格。调度边界是房间身份，不是文件目录、Project、Channel 或全局运行时。不同房间可以指向相同目录并同时写入；文件冲突由用户接受，不增加工作副本、worktree、自动合并或跨房间锁。

## User Stories

1. As a Molibot user, I want to create a named Agent Room and choose configured Agents, so that I can keep a durable multi-agent conversation in one place.
2. As a Molibot user, I want to choose a Primary Agent at room creation and change it later, so that unaddressed messages have a predictable recipient.
3. As a Molibot user, I want to create a regular room or a Project room, so that I can discuss general topics or work with the existing Project context.
4. As a Molibot user, I want rooms to appear as separate conversations in the Desktop app, so that I can reopen them without mixing them with ordinary single-agent chats.
5. As a Molibot user, I want each configured Agent to keep a separate context in each room, so that one Agent's tools and private conversation history do not become another Agent's history.
6. As a Molibot user, I want the room transcript to show which Agent authored each reply, so that I can distinguish participants and address the right one.
7. As a Molibot user, I want an unaddressed message to go to the Primary Agent, so that a room does not make every Agent answer by default.
8. As a Molibot user, I want a reply to an Agent's message to continue with that Agent when I do not explicitly mention another Agent, so that reply behavior follows the conversation.
9. As a Molibot user, I want explicit Agent mentions to take priority over the reply target, so that I can redirect a reply deliberately.
10. As a Molibot user, I want one explicit Agent mention to start that Agent with its normal configured capabilities, so that targeted work behaves like using that Agent directly.
11. As a Molibot user, I want multiple explicit mentions to start in parallel as read-only discussions, so that I can compare independent perspectives without concurrent workspace writes.
12. As a Molibot user, I want each parallel reply to stream and finish independently with its own status and failure, so that a slower or failed Agent does not hide another Agent's result.
13. As a Molibot user, I want a multi-agent discussion to use a bounded snapshot of eligible room history, with my explicitly quoted message prioritized, so that members can understand the topic without receiving the entire transcript on every turn.
14. As a Molibot user, I want a member to see eligible room history from before it joined, so that I can ask a newly added Reviewer to examine an earlier proposal.
15. As a Molibot user, I want retention and privacy rules to apply to quoted, summarized, recalled, and forwarded room content, so that a visible message is not silently made eligible for model context or memory.
16. As a Molibot user, I want to use the Agent's configured model, identity, responsibilities, and style in a room, so that a Project room does not turn distinct participants into generic assistants.
17. As a Molibot user, I want model changes to affect the next run while a running Agent keeps its starting configuration, so that configuration edits do not change an in-flight response unexpectedly.
18. As a Molibot user, I want room and Project restrictions to constrain every member while each Agent's stricter restrictions remain in effect, so that adding an Agent cannot expand its privileges.
19. As a Molibot user, I want approvals to identify the responsible Agent and exact operation, so that approving one request does not grant another member permission.
20. As a Molibot user, I want write-capable work within one room to run one at a time, so that members of that room do not race each other through the same working context.
21. As a Molibot user, I want an approval wait to hold that room's execution slot and show what is blocking it, so that another write-capable run in that room does not proceed against stale assumptions.
22. As a Molibot user, I want another room to run even when this room is writing or waiting for approval, so that room-level coordination does not block unrelated conversations.
23. As a Molibot user, I accept that two rooms or external editors can concurrently change the same file, so that room coordination stays local and does not create project-wide or global locks.
24. As a Molibot user, I want a busy Agent's new request to queue by default and allow an explicit steer into the active Run, so that additional messages do not silently replace active work.
25. As a Molibot user, I want idle recipients of a multi-agent dispatch to start while a busy recipient waits, so that one queued Agent does not delay other parallel replies.
26. As a Molibot user, I want to stop one Agent run without affecting other members, so that I can cancel only the work I no longer need.
27. As a Molibot user, I want a room-level Stop All action to cancel all active and queued room work, so that the room becomes idle until I send or explicitly resume work.
28. As a Molibot user, I want stopping to preserve completed replies and side effects, so that cancellation does not pretend to undo changes already made.
29. As a Molibot user, I want service restarts to leave unfinished runs interrupted and queued requests paused for my decision, so that a restart does not replay potentially side-effecting work without my knowledge.
30. As a Molibot user, I want retry to target only failed members and preserve their prior output and operation records, so that a successful sibling is not run again and uncertain side effects are surfaced before further execution.
31. As a Molibot user, I want removing a member to cancel its active and queued work but retain its room context, so that re-adding that Agent can continue its earlier room conversation.
32. As a Molibot user, I want a room always to have a member and a Primary Agent, so that routing is defined; when I no longer need the room, I can delete it instead.
33. As a Molibot user, I want room deletion and recovery to follow the existing recoverable Session lifecycle, so that a deletion is reversible and does not bypass existing retention rules.
34. As a Molibot user, I want permission revocation and member removal to block later restricted actions and invalidate related pending approvals, so that in-flight work cannot keep using access I withdrew.
35. As a Molibot user, I want ordinary member configuration changes to take effect on the next run, so that active work remains stable while future replies use the updated Agent.
36. As a Molibot user, I want the first version to omit conversation conversion, edit-and-resend, forks, chains, handoffs, and autonomous discussion, so that the initial room lifecycle remains understandable and recoverable.

## Implementation Decisions

### Domain and identity

- Use the domain glossary: Agent Room owns team configuration and workspace; Room Session owns one conversation and its lifecycle record; Agent Context is the model-facing continuation state for one Agent in one Room Session; Room Participant references an existing configured Agent; Primary Agent is the explicit default recipient.
- A Room is not a shared Agent Context, Subagent invocation, Runtime Task, or Durable Execution. Ordinary room messages do not automatically promote into Durable Execution.
- Resolve an explicit `agentId` into a complete runtime identity before constructing the Agent execution. Prompt assembly, model routing, permissions, tool execution, memory and telemetry must use the same identity. Do not fall back from an absent identity inside core runtime code to a Bot-derived Agent.
- Project rooms retain each Agent's configured identity and style. Project instructions constrain Project work conventions and do not replace Agent identity or weaken safety and approval rules.
- A participant uses its configured Agent model, then the Project model default, then the global model default. V1 has no room-wide model selector that overwrites every participant.
- Durable Agent self-memory uses configured Agent identity across Rooms. User and Project memory retain their existing namespaces. Room transcripts and tool histories remain room-scoped. Existing Bot-keyed self-memory is not implicitly copied into the new Agent namespace; no backwards-compatibility migration is introduced.

### Room, transcript, dispatch and execution state

- Persist Room metadata, Primary Agent and membership separately from Room Sessions. Each Room Session owns a visible transcript and per-member Context links; each agent continuation stays in its existing Agent Context storage and workspace layout.
- Persist one user message for a multi-agent dispatch, not one duplicate per recipient. Store stable message identifiers, author Agent identity for assistant messages, reply target, dispatch identity and per-participant execution status.
- Stream one correlated set of per-Agent events through the Desktop chat transport. Events and persisted messages identify the Room, Session, dispatch, Agent, and execution so reconnect/reload does not duplicate messages or attach output to the wrong participant.
- Persist queue position, execution owner and terminal/waiting status in database state governed by the existing state-machine and recovery rules. Concurrency-protected fields are queryable columns rather than display-only JSON.
- Parse selected Agent mentions as structured configured Agent identifiers. Natural-language `@` in an Agent response is display text and never triggers another Agent.
- Capture one bounded current-session context snapshot when a user message is accepted. Every recipient in that dispatch receives the same eligible shared snapshot plus its own Agent Context; sibling output from the same dispatch is not injected automatically. A follow-up or explicit quote can reference that output.
- Apply the source turn's retention policy to every derived room-context projection. `turn_only` content never re-enters a later Agent Context, search, or memory merely because it remains visible in the transcript.

### Dispatch, tools and room-local write coordination

- No mention routes to the current Primary Agent. Reply metadata routes to that Agent unless explicit mentions are present. One explicit mention is a direct full-capability Run; two or more mentions create parallel read-only discussion Runs. Discussion is a capability restriction, not an instruction to propose a plan.
- Multi-agent discussions reuse the restricted local-read tool allowlist without automatically entering Plan mode. An explicitly configured Plan permission mode still applies. They cannot invoke Bash, Host Bash, MCP, Mini App tools, `webSearch`, or `webFetch`. This is not a promise of zero persistence: transcript, execution records and an authorized plan artifact can still be stored. Do not infer read-only behavior from an Agent's text or an external tool's self-declared annotation.
- A Run with write-capable tools must acquire the Room's single write slot before it can execute. Keep that slot through the Run, including pending approval, and release it only at completion or cancellation. A denied action may continue only according to existing policy while retaining the same slot.
- The slot key is the Room identity, never a file path, Project ID, Bot, Channel, process-wide flag, or global writer key. Other Rooms may use the same directory and write concurrently; conflicts are an accepted outcome. Existing write conflict checks remain in force but are not represented as cross-Room isolation.
- This coordination applies only to writes initiated by participants in that Room. It does not block ordinary chats, automations, other Rooms, editors, shell processes or external systems that share the same resources.
- A busy participant queues its next message in order. In a multi-agent dispatch, idle participants start immediately and busy participants wait independently. An explicit steer injects only into the chosen active Run; per-Agent Stop aborts only that Run unless the user invokes Room Stop All.
- Stop All cancels all active runs and queued dispatch entries for that Room. Per-run Stop affects only that participant execution. Neither operation reverses completed file or external side effects.
- On process recovery, unfinished executions become interrupted and are not automatically replayed; pending queue entries become paused. Resuming or retrying requires an explicit user action and follows the recovery contract below. A partial dispatch retry targets failed participants only and never repeats successful participants.

### Permissions and lifecycle

- Permission resolution combines the Room/Project maximum with each Agent's stricter configured limits. Room membership never increases an Agent's authority. Approval records and visible prompts name the requesting Agent and operation, and grants do not transfer to other participants.
- Permission revocation and participant removal immediately deny later protected actions, invalidate pending approvals for that Agent, and stop the execution when necessary. Completed external side effects remain completed.
- Ordinary Agent configuration and model changes apply to new Runs; in-flight Runs keep their initial resolved identity and configuration.
- Removing a participant cancels its active and queued Room work but retains its participant context and transcript attribution. Re-adding that Agent resumes its retained Room context. A replacement Primary must be chosen before removing the current Primary; a Room cannot be left without a member.
- Room delete/restore uses the current recoverable Session lifecycle and retention period. Active execution, queued execution, and pending approvals participate in busy checks; deletion does not silently cancel them or delete Project root files.
- V1 creates new rooms only. It does not convert existing single-agent sessions, edit-and-resend, fork, chain, hand off between Agents, or autonomously start Agents from Agent-authored mentions.

### Product surface

- V1 is Desktop-only and supports regular and Project Rooms. Web and Telegram/Feishu group-chat support are future directions, not V1 acceptance scope.
- The composer offers mention suggestions from available configured Agents. Room setup selects members and a Primary Agent, defaulting to the first selected member; the Primary can be changed afterward.
- The transcript presents user messages once and gives every Agent reply a distinct name and identity. Multi-agent runs display independent streaming, queued, waiting-for-approval, stopped, failed and completed states, with per-Agent Stop and Room Stop All.
- Use the existing chat transport, session lifecycle, Runner and approval surfaces through one shared Room orchestration service. Do not put coordination or queue semantics in Channel adapters.
- UI follows the existing DESIGN.md and shadcn-svelte conventions, works at narrow Desktop widths, and supports Chinese/English plus light/dark themes.

## Execution Contracts

These contracts define V1 behavior. Delivery slices do not reduce the final acceptance scope.

### Runtime identity and configuration

- Resolve one runtime identity before creating a Run: configured Agent ID, Room ID, participant Context ID, execution ID, and the applicable owner and Project scope. Keep Bot/Channel transport identity separate from Agent identity.
- Prompt assembly, all model routes (including compaction and media), tools, permission checks, memory namespaces, approval ownership, and telemetry consume the same resolved Agent identity. A missing, disabled, or deleted Agent fails explicitly; it never silently becomes the Primary Agent or a Bot-derived Agent.
- Snapshot ordinary Agent configuration and model selection at Run start. Queued work resolves current configuration when it starts. The model precedence remains Agent → Project → global.
- Security authority is not frozen by that snapshot. Before each protected action and approval resume, revalidate current membership and Room/Project/Agent restrictions. Revocation invalidates pending approvals and denies later protected actions; an already-issued external operation may have completed and cannot be assumed reversible.
- A restored execution does not regain authority through a stale configuration snapshot or approval. Approval decisions bind to the requesting Agent, execution, and exact operation.

### Durable scheduling and state transitions

A dispatch contains one accepted user message and one execution entry per selected participant. Each retry creates a new execution entry linked to the original; it does not overwrite prior evidence.

| State | Meaning | Allowed next states |
|---|---|---|
| queued | Accepted, awaiting participant availability or Room writer eligibility | running, paused, cancelled |
| running | Runner is active | waiting_approval, cancelling, completed, failed, interrupted |
| waiting_approval | Run is suspended for its own approval; writer ownership is retained | running, cancelling, failed, interrupted |
| cancelling | Cancellation requested; execution has not yet become quiescent | cancelled, interrupted |
| paused | Pending work stopped by process recovery | queued through explicit resume, cancelled |
| completed / failed / cancelled / interrupted | Terminal execution record | No in-place restart; explicit retry/continuation creates a linked execution |

- At most one Run is active for a participant Context. Additional messages queue by default; steer targets only the selected active execution and is rejected when that execution is not able to accept it.
- Assign a durable acceptance order within the Room. Write-capable executions acquire the Room writer slot in that order; an older paused entry does not block explicitly resumed or newly accepted work. Read-only discussion executions do not acquire the writer slot and may run alongside another member's writer, subject to their own participant availability. A busy participant does not block idle discussion recipients.
- Slot acquisition and the transition to running are atomic. Persist Room ID, execution owner and an ownership generation sufficient to reject stale releases and callbacks. All Room execution entry paths, including retry, continuation and approval resume, obey the same scheduling service.
- Requesting cancellation does not release the writer slot. Release it only after the Runner and its outstanding operations are quiescent, or after recovery establishes that the previous process execution is no longer active. Pending approval alone is not completion. Denial follows existing policy while retaining ownership if the Run continues.
- Stop All atomically cancels entries accepted before its scheduling boundary and requests cancellation of their active executions. A later accepted message is new work; it follows normal scheduling and cannot bypass an execution still cancelling.
- Accept messages using a client-generated submission ID scoped to the Room. Repeating the same submission returns the original dispatch; conflicting payloads for that ID are rejected. Retry and continuation use their own submission IDs. SSE events carry execution identity and a monotonic replay position; reconnect cannot append a second copy of a persisted message or apply an event to a newer execution.
- Retain terminal records as history, but remove them from runnable queue indexes. On service restart, unfinished active executions become interrupted, queued entries become paused, and stale approval/slot ownership cannot reactivate them automatically.

### Retry, continuation and uncertain side effects

- Retry means a new Run for selected failed participants. It uses the original accepted input and eligible shared snapshot, applies current membership/permission checks, and preserves earlier partial output and operation records. Successful siblings remain completed.
- Continue means a new linked Run for interrupted work after explicit user action. It receives eligible prior progress and the recorded operation outcomes; it is not a promise to restore an arbitrary tool call stack or exactly resume a model stream.
- Approval resume is separate: it resumes a live waiting execution for its exact approved operation after authority is revalidated. After restart, an old approval cannot itself replay interrupted work.
- Recorded outcomes distinguish completed, failed, and unknown operations. An external operation that timed out or lost its response is unknown unless authoritative evidence establishes its result. Do not automatically repeat it as if it never occurred; pause the continuation for reconciliation or an explicit user decision about repetition.
- Use existing tool-specific progress and conflict checks where available. V1 does not promise exactly-once side effects for arbitrary external tools, rollback, or universal automatic recovery. Cancellation and failed retries retain completed effects and visible evidence.

### Shared context projection and retention

- Capture a shared snapshot at acceptance, using a transcript sequence boundary. Select only source turns eligible for future context; prioritize an eligible explicit quote, then the most recent eligible completed messages, rendered chronologically with stable source IDs and author attribution. An unfinished sibling reply is not a completed message eligible for this snapshot.
- Budget against the smallest usable shared-context allowance among the intended recipients after reserving space for instructions, their own Context, current input/attachments, and output. Send the same shared source content to all recipients. If the minimum allowance cannot fit required input, reject with a clear explanation rather than silently giving members different evidence.
- Establish one documented default budget in the shared projection service; no new user-facing configuration is required. Drop older unquoted messages first. Truncate oversized eligible quotes/messages deterministically, with an explicit truncation marker; never silently treat an excerpt as the complete source.
- Do not present a participant's own prior turn twice merely because it also appears in shared history. Preserve source-turn IDs through projection and compaction so overlaps can be identified without merging different Agents' tool histories.
- A model/configuration change before queued work starts must not expand or recapture the accepted snapshot. If the new model cannot fit it, require a new explicit submission rather than independently trimming it for one recipient.
- Apply all retention dimensions to projections, summaries, responses and plan artifacts derived from shared sources. Future-context, search and memory eligibility each inherit the most restrictive relevant source rule. In particular, `no_memory` source content cannot become memory-eligible through another Agent's response, and `turn_only` content cannot be reintroduced by a later quote.
- Retention checks precede quote priority. A visible but ineligible quote is rejected with an explanation; an explicit quote does not implicitly change its original retention policy. Current-turn `turn_only` input can reach all intended recipients of that dispatch, but neither it nor its derived content is later eligible.
- Plan-artifact persistence does not override source retention. An external file/export requires explicit authorization for that action, consistent with the existing retention ADR.

### Target validity and attribution

- Only current enabled Room members are selectable mention targets. Reject unknown, removed, disabled or deleted targets explicitly; do not silently route to Primary.
- Replying to a former member without an explicit valid mention is rejected with a request to select a current member. A valid explicit mention still overrides the reply target.
- Agent configuration deletion/disable cancels its pending Room work, invalidates approvals, and requests cancellation of active work. If it is Primary, block unaddressed routing until the user chooses an enabled replacement; do not invent a replacement identity.
- Persist stable author Agent IDs and the display name at message creation, so renaming or deleting configuration does not rewrite historical attribution.
- Removing and re-adding the same configured Agent retains its Context but never revives cancelled entries or old approvals. A newly created Agent with the same name is a different identity.
- Member removal and Primary replacement are validated atomically. If global Agent deletion leaves no enabled Room member, retain the Room as unavailable until the user adds a valid member or deletes it; existing history remains readable.

### Composer and execution visibility

- Before sending, display the resolved recipients and execution mode. Multiple mentions visibly select “多人讨论 · 受限 Plan 模式” / “Multi-agent discussion · restricted Plan mode”; explain that search, MCP, Mini Apps and shell execution are unavailable in this mode.
- Provide an explicit “交给此成员执行” / “Ask this member to execute” action on a discussion reply. It prepares a single-member targeted message with eligible reply context and requires the user's send action; it never automatically starts execution from Agent-authored text.
- Display why a queued entry is blocked (participant busy or Room writer occupied), including the responsible member and approval wait when applicable. Show cancelling until actual cancellation completes; show unknown external outcomes distinctly from confirmed failures.

## Delivery Order

1. **Identity and minimal end-to-end Room:** explicit runtime identity, Room persistence, one-member dispatch, independent participant Context, author attribution, and reopen/reload. Verify identity across prompt/model/permissions/memory/tools/approvals before expanding dispatch.
2. **Parallel discussion:** structured mentions and replies, a bounded common snapshot, retention propagation, independent streams, submission/replay deduplication, and partial failure isolation.
3. **Execution lifecycle and Desktop completion:** atomic Room writer ownership, queueing, approval waits, cancellation, removal/re-addition, retry/continuation, restart recovery, recoverable deletion, final UI adaptation and cold-start checks.

Each slice must remain runnable and pass its relevant checks. All three slices are required for V1 acceptance; this order does not authorize temporary compatibility paths or weaker security/lifecycle guarantees.

## Testing Decisions

- **Highest test seam:** the shared Room orchestration service used by the Desktop chat stream. Inject the Session/Room store, configured Agents, runner factory and approval collaborator; exercise real dispatch behavior through the Desktop stream API where practical. Do not add test-only public seams to Agent internals.
- Test externally visible behavior and durable outcomes: recipient choice, author attribution, independent streams, queue order, the Room-only writer slot, cross-Room concurrency against a shared directory, cancellation, pending approvals, and recovery after restart. Avoid asserting private helper calls or the exact database layout.
- Persistence tests use temporary databases and temporary data directories. Prove Room create/update/reload for membership, Primary, participant Context links, messages, queue state and writer-slot recovery.
- Prior art: the existing Desktop SSE transport tests, RunnerPool and approval-suspension tests, Project runtime routing tests, Session lifecycle tests, permission resolution tests, and persistent queue recovery tests. Extend the highest relevant service/route coverage rather than creating a second low-level test framework.
- Dispatch scenarios: no mention; reply to one Agent; explicit mention overrides reply target; multiple mentions start together in restricted mode; Agent-generated mentions remain plain text; attachments and retention constraints reach all intended recipients exactly once.
- Concurrency scenarios: two write-capable participants in one Room serialize; a waiting approval retains that Room's slot; cancellation releases it; another Room pointed at the same directory proceeds concurrently; a queue restart pauses pending entries; stale or duplicate submissions do not fork or duplicate a Run.
- Failure scenarios: one parallel member fails while another completes; only the failed member resumes; completed and unknown operation outcomes are reconciled before resumed side effects; Stop All cancels Room pending work; per-Agent Stop leaves sibling work unaffected; permission revocation invalidates pending approval.
- Lifecycle scenarios: remove/re-add participant retains its Agent Context; Primary replacement is required; last-member removal is rejected; Room deletion observes active/queued/approval state and existing recoverable restore behavior.
- Implementation delivery must also complete project-required typecheck, test, build and desktop cold-start checks, including restart, first Room open, switching Rooms, interruption recovery, and confirming a blocked Room does not block another Room.

- Additional contract scenarios: distinct Agent identities in the same Project retain their model routes, prompt styles, memory namespaces and approval ownership; ordinary configuration snapshots remain stable while permission revocation is enforced on the next protected action.
- Scheduling races: abort remains cancelling until quiescent; no writer starts before release; stale releases cannot clear a newer owner; Stop All racing with submission has the documented boundary; duplicate submissions/replayed SSE events do not create duplicate executions or messages.
- Context scenarios: mixed model windows receive the same shared source content; own-history overlap is deduplicated; oversized quotes are marked; queued configuration changes cannot silently recapture the snapshot; ineligible quotes are rejected; derived summaries, replies and plan artifacts preserve each retention dimension.
- Target scenarios: reply to removed member; Agent rename, disable and deletion; Primary invalidation; last enabled Agent disappearing; re-addition without reviving queued work or approvals; a new Agent with an old name does not inherit the old identity.
- Recovery scenarios: failed-member retry creates linked evidence without rerunning successful siblings; interrupted continuation is explicit; old approvals cannot replay work after restart; uncertain external outcomes stop automatic repetition and remain visible.

## Out of Scope

- Agent-to-Agent autonomous invocation, roundtables, chains and handoffs.
- Room-wide write locks by directory, Project, Channel or process.
- Separate working copies, Git worktrees, file synchronization, conflict resolution or automatic result merging.
- Preventing a different Room, ordinary session, automation, external editor, shell process or external service from changing a shared file or resource.
- Multi-Agent network search, web fetch, MCP and Mini App access during parallel Plan/read-only discussions.
- Web, Telegram or Feishu Room UI in V1; their identity and group-member access policy require a later design.
- Existing single-agent conversation conversion, history edit/resend and Room forks.
- Automatic replay of interrupted side-effecting work, arbitrary tool-stack restoration, universal exactly-once external effects, and automatic rollback.
- Making Room transcript context equivalent to durable memory or bypassing Turn Retention Policy.
- Replacing Subagent, Runtime Task, Durable Execution, Project Runtime or the existing Agent Context model.

## Further Notes

- This spec records product choices from the design interview and supersedes its temporary notes. The glossary defines Agent Room, Room Participant, Primary Agent and Room Workspace.
- Existing constraints remain authoritative: [memory namespaces and turn retention](../adr/0001-memory-namespace-and-turn-retention.md); [per-domain database ownership and state representation](../adr/0004-per-domain-databases-and-state-representation.md); [Session delete/restore lifecycle](session-management-spec.md); Project Runtime configuration, permissions and approval resume behavior from [Project Automations](project-automations-prd.md).
- The significant accepted tradeoff is that room-local scheduling does not prevent cross-room file conflicts. The product guarantees that one Room will not start two of its own write-capable Runs concurrently; it does not guarantee exclusive ownership of a shared directory.
- Implement the runtime identity and durable scheduling contracts below before expanding the UI. The implementation must demonstrate atomic Room writer ownership and explicit Agent identity through model routing, prompt assembly, permissions, memory, tools and approval ownership.
