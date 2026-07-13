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
