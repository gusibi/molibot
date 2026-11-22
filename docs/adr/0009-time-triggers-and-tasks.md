# ADR 0009: Users see two kinds of work — time triggers and tasks

## Status

Accepted — 2026-11-19. Extends [ADR 0003](0003-runtime-tasks-and-mini-app-todo-boundary.md); its Mini App Todo boundary is unchanged.

## Context

Molibot grew several user-facing objects that each mean “something the Agent will do later”: Runtime Task todos, reminders and periodic automations, Project automations, the session-generated plan board, Kanban Tasks, Durable Executions, and a proposed separate follow-up domain. Each carries its own state, list view and vocabulary. Users must learn which one to use. Each new capability also tempts a new store, a new scheduler path and new approval or budget rules.

The always-on Agent loop needs only two things from the user's point of view: something that wakes the Agent at a time, and something the Agent is responsible for until it is finished.

## Decision

1. **Time trigger** (`Runtime Task`): a one-shot reminder or a periodic automation, including Project-scoped automations. It answers “when”. It is backed by watched-event JSON and the runtime event system, as ADR 0003 states. It does not track progress toward an outcome.
2. **Task** (`Kanban Task`): work the user has handed over, with an owner, completion conditions, progress, evidence and a lifecycle that ends in Done or cancelled. It answers “what, and is it finished”. It is backed by the Durable Execution aggregate. Legacy plans are projected as tasks. Ongoing follow-up of a delegated matter is a task running in `follow_up` mode, not a separate domain.
3. **Durable Execution is the engine, not a user concept.** User-facing surfaces present tasks; Durable Execution names the runtime and storage that run them.
4. **Times inside a task are task state.** A task's next check, fixed check-in or expiry is a durable wakeup owned by the task. It is not a Runtime Task and does not appear in the time-trigger list. A time trigger may later create a task (Kanban Spec phase two); that is the only link between the two.
5. **No third kind.** A new capability that “does something later” must fit one of the two kinds, or extend a task mode. It must not add another top-level store, list or scheduler path.
6. **The Runtime Task `todo` type is removed.** An unscheduled todo never fires, had no UI entry point, and was not a time trigger. Runtime Tasks now cover only `one-shot` reminders and `periodic` automations.
7. The optional Mini App Todo stays outside both kinds, per ADR 0003.

## Consequences

- Follow-up reuses the task aggregate's identity, versioning, wakeups, approvals, evidence, receipts and board projection. It adds no follow-up database or worker.
- Board, home and notification views can describe all handed-over work with one vocabulary.
- Reviews can reject designs that introduce a parallel task store, scheduler or lifecycle by pointing to this ADR.
