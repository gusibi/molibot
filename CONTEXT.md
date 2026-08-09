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

**Notification**:
A user-facing delivery attempt or outcome produced by a Runtime Task or another authorized caller. It does not own scheduling state and is not durable Agent Context or memory.
_Avoid_: Reminder, Runtime Task, control prompt, debug event

**Mini App Todo**:
An optional Mini App-owned entity whose storage, CRUD, and business rules belong entirely to that app. It may request a Runtime notification through an explicit capability, but it never becomes a Runtime Task source of truth and neither side reads, mutates, or cascades into the other's records.
_Avoid_: Runtime Task, shared todo table, Runtime task projection
