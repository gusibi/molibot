# ADR 0003: Runtime Tasks and the Mini App Todo boundary

## Status

Accepted

## Context

Molibot has watched-event files for reminders and automations, user-facing task views, and an optional Todo Mini App. Treating every item called “todo” as one domain would make the base Agent Runtime depend on an app that may not be installed, while treating reminders, events, notifications, and todos as four independent resources would create competing sources of truth.

The existing Agent tool could create watched events but could not list, inspect, update, or delete the resulting user task. Runtime execution events and notification delivery state were also easy to mistake for user-editable tasks.

## Decision

- `Runtime Task` is the Agent Runtime CRUD aggregate. A `todo` is unscheduled and never dispatched; a one-shot task is a reminder; a periodic task is an automation.
- `Runtime Event` is a trigger/execution occurrence. `Notification` is a delivery attempt or outcome. Neither is a second task store or an independent CRUD aggregate.
- The optional Mini App Todo is a separate bounded context. Its installation, storage, CRUD, and business rules never participate in Runtime Task discovery or mutation. The Runtime remains complete when the app is absent.
- The Agent uses the deferred `runtimeTask` tool for create/list/get/update/delete. User-managed tasks remain backed by watched-event JSON and the runtime event system.
- Immediate and Molibot-managed internal events are not exposed through user Runtime Task CRUD. The watcher recognizes plain todos only to retain them; it never dispatches them.
- A Mini App may later receive a narrow, explicit “request notification” host capability. Such a call creates a delivery request only; it does not synchronize Todo records or grant access to Runtime Tasks.

## Consequences

- Installing or removing the Todo Mini App cannot add, remove, or rewrite Agent Runtime reminders and automations.
- Users and the Agent can manage reminders and automations by stable task id without manually editing event files.
- Execution history and notification state can evolve independently without becoming duplicate task databases.
- Cross-product views may visually combine results in the future, but they must preserve ownership and route mutations back to the owning domain.
