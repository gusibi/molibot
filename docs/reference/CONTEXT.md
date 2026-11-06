# Molibot Context

Molibot coordinates user-facing conversations with the Agent state required to
continue them across supported channels and interfaces.

## Language

**UI Session**:
The user-interface view of a conversation, including its display metadata and presentation state.
_Avoid_: User session, users data

**Agent Context**:
The model-facing continuation state of a conversation, including model and tool history.
_Avoid_: UI history, Session UI data

**Agent**:
A configured, reusable assistant identity that can participate in multiple conversations. Its identity is distinct from the conversation context of any one room.
_Avoid_: Room-local role, individual Run, Bot instance

**Agent Room**:
A long-lived, user-visible conversation with multiple configured Agents, each with its own room-specific Agent Context. The term describes the conversation, not a shared model history.
_Avoid_: Shared Agent Context, Subagent invocation

**Room Participant**:
A configured Agent participating in an Agent Room. The same Agent can be a participant in multiple rooms without sharing their conversation contexts.
_Avoid_: Temporary worker, room-local Agent definition

**Room Workspace**:
The working directory used by an Agent Room's participants; multiple rooms may use the same directory and files. Writable execution is coordinated within each room, without excluding concurrent writes from other rooms.
_Avoid_: Isolated working copy, Agent private context, project-wide write lock

**Session Agent（会话所属 Agent）**:
The fixed assistant identity owning an ordinary Personal Agent conversation. It is distinct from an Agent Room's default recipient; Project conversations retain their existing behavior in V1.
_Avoid_: Primary Agent, current Channel binding

**Default Agent（默认 Agent）**:
The enabled assistant selected for Desktop’s global New chat action. It is distinct from an existing Session’s fixed Agent and an Agent Room’s Primary Agent.
_Avoid_: Session Agent, Primary Agent, Channel binding

**Execution Identity（执行身份）**:
The single Agent identity a request actually runs as, resolved from its admission mode and persisted ownership. It carries exactly one `agentId`; there is no separate channel or Bot identity.
_Avoid_: Channel Agent, Bot identity, effective Agent

**Claim（认领）**:
The one-time operation that assigns ownership to an unassigned conversation. It changes which Agent’s history lists that conversation; it does not grant execution or make an external conversation continuable.
_Avoid_: Adopt, import, migrate

**Primary Agent**:
The explicitly selected default participant in an Agent Room, addressed when a user message neither names target Agents nor replies to a participant's message. Addressing another participant does not change the Primary Agent.
_Avoid_: Last speaker, coordinator, parent Agent

**Reply Usage**:
The cumulative model-token usage attributed to one user turn, including the model calls before and after its tool results. It belongs beneath that turn's reply.
_Avoid_: Session usage, reply length, context size

**Session Usage**:
The cumulative model-token usage incurred by one conversation across its lifetime. Context compaction or deletion of individual messages does not reduce usage already incurred.
_Avoid_: Context capacity, last reply usage

**Context Occupancy**:
The context in use right now: the last model request's input (cached input included) plus that request's reply — the size the next dispatch starts from, measured against the model's context window.
_Avoid_: Session consumption, cumulative token usage, input-only size

**Session Cache Hit Ratio**:
The fraction of a conversation's reported input tokens served by cache reads, calculated from summed token counts. It is distinct from an arithmetic mean of turn-level percentages.
_Avoid_: Average reply hit rate, cache savings, output-token ratio

**Memory Namespace**:
The authorization and ownership boundary of a durable memory. New user facts and preferences use `owner:<ownerId>`; project facts use `project:<ownerId>:<projectId>`; Personal Agent self-knowledge uses `agent:<agentId>`; published-content reference uses `content:<botId>`. `chat:<botId>:<channel>:<chatId>` is a conversation retrieval boundary, not the default home for durable personal memory.
_Avoid_: Storage path, Session ID, memory type

**Owner Memory（Owner 记忆）**:
Durable user facts and preferences shared among authorized ordinary Agents of the same owner. A private conversation with one Agent does not by itself make those facts private to that Agent.
_Avoid_: Agent self-knowledge, private conversation history

**Agent Private Knowledge（Agent 私有知识）**:
Knowledge about an Agent’s own identity and role, isolated by its stable identity. It does not imply support for privately retaining individual user facts for that Agent.
_Avoid_: Owner memory, all facts learned in a private conversation

### Memory lifecycle

**Memory Record**:
One stored, in-effect version of a durable memory.
_Avoid_: item, row, entry

**Memory Proposal**:
An extracted memory that has not been accepted; never recalled.
_Avoid_: candidate, pending memory, draft, 待确认记忆

**Memory Revision**:
A record that replaces an earlier record for the same subject.
_Avoid_: update, overwrite, conflict

**Memory Subject**:
The stable slot a memory occupies, which decides what a new value revises. The same subject may appear in only one active record.
_Avoid_: key, topic, path

**Memory Scope**:
The execution context a read or write runs in (channel, user, Bot, Agent, project); it determines which namespaces are authorized.
_Avoid_: namespace, tenant

**Memory Domain**:
What a memory is about and who owns it: the owner, a project, the Agent itself, or published content.
_Avoid_: namespace, category

**Sensitive Fact**:
A memory about health, medication, allergies, location, identity, relationships, politics, religion, sexuality, or income. It becomes a proposal until the user confirms it.
_Avoid_: private memory, risky memory

**Memory Extraction**:
Turning conversation into proposals or records.
_Avoid_: flush, reflection, session extraction, import

**Memory Recall**:
Selecting records for the current turn.
_Avoid_: search, retrieval, lookup

**Memory Injection**:
The records finally placed in the model's prompt for a turn.
_Avoid_: context, attachment

**Referenced Memory**:
A record the reply actually used, as opposed to one merely injected.
_Avoid_: used, cited

**Stable Profile**:
The always-injected view of a user's preferences and facts.
_Avoid_: summary, persona, user model, 用户画像

**Embedding Lane**:
One independently configured embedding target: name, host URL, API key and model. Multiple lanes may exist; exactly one is active.
_Avoid_: vector provider, embedding config, 向量服务商

**Embedding Target**:
The active embedding lane used to vectorize memories for recall; absent means lexical retrieval only.
_Avoid_: vector provider, embedding config, 向量服务商

**Memory Active**:
A record available for recall.
_Avoid_: confirmed, approved, saved

**Memory Disputed**:
A record the user has marked wrong, or one that contradicts another record for the same subject; not injected until resolved.
_Avoid_: conflicted, flagged, pending

**Memory Archived**:
A record kept for history but no longer recalled.
_Avoid_: deleted, removed

**Memory Forgotten**:
A memory removed on request and suppressed from being extracted again.
_Avoid_: deleted, cleared

**Turn Retention Policy**:
One canonical policy attached to every entry produced by a user turn. `standard` allows future Agent Context, conversation search, and memory; `no_memory` allows context/search but forbids memory; `not_searchable` allows context but forbids both search and memory; `turn_only` keeps a visible audit transcript but forbids all three. Missing policy means `standard`.
_Avoid_: Privacy flag, temporary prompt instruction

**Delete**:
A target-specific, non-cascading destructive operation, not a retention policy. A request must identify a memory item, message/turn, or Session; deleting conversation data tombstones its search projection, while deleting a memory also suppresses re-import of the same item. To remove both a source turn and a derived memory, name both targets.
_Avoid_: Don't remember, hide, reset context

**Kanban Task（看板任务）**:
A user-delegated goal assigned to one Agent or an Agent Team, with a stable identity across execution, collaboration, waiting, and delivery. It may belong to a Project; it is distinct from a scheduling rule, a conversation, and one execution round.
_Avoid_: Runtime Task, Mini App Todo, Room execution

**Todo / Doing / Done（看板阶段）**:
Todo means accepted but not started; Doing means started and not yet completed, including waits; Done means the task's completion conditions have been met, including human acceptance when required. These are stages of a Kanban Task, not individual Agent execution outcomes.
_Avoid_: Runtime Task.todo, successful Run as task completion

**Team Coordinator（团队负责人）**:
The Agent responsible for choosing the next team member to advance a Kanban Task and deciding whether the combined results satisfy its completion conditions. This responsibility is distinct from an Agent Room's Primary Agent, which only selects the default recipient of a message.
_Avoid_: Primary Agent, last speaker

**Member Handoff（成员交接）**:
A transfer of responsibility for advancing a Kanban Task from one executing team member to another, including a return for revision. Initial assignment and coordinator-only scheduling do not count as member handoffs; model turns inside one member's execution are counted separately.
_Avoid_: model turn, tool call, coordinator decision as a handoff

**Runtime Task**:
A user-manageable Agent Runtime scheduling item stored as watched-event JSON. Within watched-event scheduling, Runtime Task is the only CRUD aggregate: `todo` is unscheduled and never dispatched, `one-shot` represents a reminder, and `periodic` represents an automation. It is distinct from a Kanban Task delegated to an Agent or Team.
_Avoid_: Mini App Todo, Event, Notification

**Runtime Event**:
A trigger or execution occurrence produced while running a Runtime Task. It is execution state, not a second user task list and not the object users edit as a todo.
_Avoid_: Todo, reminder record, calendar event

**Durable Execution**:
A user-owned goal that may span multiple bounded Agent Context attempts and remains accountable until its acceptance criteria reach a terminal outcome. It is separate from Runtime Task scheduling, conversation history, and Channel transport.
_Avoid_: Runtime Task, Agent Context, long-lived Session, workflow DAG

**Execution Attempt**:
One bounded effort to advance a Durable Execution. An attempt may stop, wait, fail, or complete without changing the identity of the parent Durable Execution.
_Avoid_: Run as the whole user goal, retry as a new task

**Execution Step**:
One ordered unit of work in a Durable Execution plan, with its own state, side-effect risk, and evidence. Completed steps retain their evidence when a later plan version is created.
_Avoid_: tool call, chat message, acceptance criterion

**Acceptance Criterion**:
A user-visible condition that must be supported by evidence before a Durable Execution can be completed. It is distinct from a step because one criterion may depend on several steps.
_Avoid_: model's completion sentence, successful tool call

**Evidence**:
A bounded, authorized reference and human-readable summary that supports a step or acceptance criterion. Evidence can become unavailable without turning the work that produced it into a failure.
_Avoid_: hidden debug record, model narration, full artifact content

**Side-effect Record**:
The accountable record of an operation that may change the outside world, including its intent and any later receipt. It carries enough target and timing information for a person to verify what happened.
_Avoid_: tool name alone, ordinary chat message, approval grant

**Decision Request**:
A structured question that blocks safe continuation until the user chooses from allowed options. The answer belongs to the Durable Execution and is applied only once to the matching request.
_Avoid_: free-form follow-up, approval grant, waiting status without a question

**Safe Resume Point**:
The first point at which a Durable Execution may continue safely, derived from plan version, step state, evidence, side-effect classification, and any required user decision.
_Avoid_: an integer step index, replaying the original prompt

**Activation Path**:
The reason a request became a Durable Execution: a deterministic signal that creates it before work, or a bounded lazy promotion at a non-pure action boundary.
_Avoid_: global mode switch, per-turn classifier requirement

**Execution Briefing**:
The structured handoff presented to a fresh attempt: goal, constraints, live criteria, completed evidence summaries, current step input, and the previous failure or wait reason.
_Avoid_: copied transcript, debug log, control prompt

**Agent Handover（交接）**:
The retrospective summary the Desktop home presents when the user returns after being away: what was completed, what needs the user's decision, and what will happen next. Its window starts at the user's last acknowledged view, not the calendar day. It is not a conversation, carries no Agent Context, and is not a Session.
_Avoid_: Execution Briefing, daily digest, Activity Feed, overview dashboard

**Open Loop（未接回的话题）**:
A topic the user is expected to continue but has not: something the Agent delivered that the user never opened, or a thread the user stopped replying to after the Agent asked or answered. It is inferred only from observable signals, never from a model's guess about the user's intent, and it is neither a Runtime Task nor a Decision Request.
_Avoid_: pending question, follow-up reminder, nudge, blocked item

**Task Budget**:
The cumulative token, attempt-count, and lifetime limits that bound a Durable Execution independently of the budget of any one attempt.
_Avoid_: per-turn Run budget, provider quota, global concurrency cap

**Notification**:
A user-facing delivery attempt or outcome produced by a Runtime Task or another authorized caller. It does not own scheduling state and is not durable Agent Context or memory.
_Avoid_: Reminder, Runtime Task, control prompt, debug event

**Mini App Todo**:
An optional Mini App-owned entity whose storage, CRUD, and business rules belong entirely to that app. It may request a Runtime notification through an explicit capability, but it never becomes a Runtime Task source of truth and neither side reads, mutates, or cascades into the other's records.
_Avoid_: Runtime Task, shared todo table, Runtime task projection
