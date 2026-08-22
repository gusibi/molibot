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

**Memory Namespace**:
The authorization and ownership boundary of a durable memory. New user facts and preferences use `owner:<ownerId>`; project facts use `project:<ownerId>:<projectId>`; Agent self-knowledge uses `agent:<botId>`; published-content reference uses `content:<botId>`. `chat:<botId>:<channel>:<chatId>` is a conversation retrieval boundary, not the default home for durable personal memory.
_Avoid_: Storage path, Session ID, memory type

**Turn Retention Policy**:
One canonical policy attached to every entry produced by a user turn. `standard` allows future Agent Context, conversation search, and memory; `no_memory` allows context/search but forbids memory; `not_searchable` allows context but forbids both search and memory; `turn_only` keeps a visible audit transcript but forbids all three. Missing policy means `standard`.
_Avoid_: Privacy flag, temporary prompt instruction

**Delete**:
A target-specific, non-cascading destructive operation, not a retention policy. A request must identify a memory item, message/turn, or Session; deleting conversation data tombstones its search projection, while deleting a memory also suppresses re-import of the same item. To remove both a source turn and a derived memory, name both targets.
_Avoid_: Don't remember, hide, reset context

**Runtime Task**:
A user-manageable Agent Runtime work item stored as watched-event JSON. Runtime Task is the only CRUD aggregate: `todo` is unscheduled and never dispatched, `one-shot` represents a reminder, and `periodic` represents an automation.
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

**Task Budget**:
The cumulative token, attempt-count, and lifetime limits that bound a Durable Execution independently of the budget of any one attempt.
_Avoid_: per-turn Run budget, provider quota, global concurrency cap

**Notification**:
A user-facing delivery attempt or outcome produced by a Runtime Task or another authorized caller. It does not own scheduling state and is not durable Agent Context or memory.
_Avoid_: Reminder, Runtime Task, control prompt, debug event

**Mini App Todo**:
An optional Mini App-owned entity whose storage, CRUD, and business rules belong entirely to that app. It may request a Runtime notification through an explicit capability, but it never becomes a Runtime Task source of truth and neither side reads, mutates, or cascades into the other's records.
_Avoid_: Runtime Task, shared todo table, Runtime task projection
