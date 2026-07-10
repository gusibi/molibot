# Findings

## Product-design interview (2026-07-10)

The user approved all decisions recorded in `task_plan.md`, including the
three-level tree, multi-expand behavior, persisted expansion state, draft reuse
rules, and contextual header format.

## Current desktop structure

- `apps/desktop/src/App.svelte` owns a `mainView: "chat" | "projects"` switch
  and renders `ProjectsView` independently. This must be removed as part of
  unification.
- `apps/desktop/src/lib/chat/ChatSidebar.svelte` currently renders top-level
  new-chat, projects, automation, and skills actions, followed by channel
  accordions. It supports exactly one expanded channel via `expandedChannel`.
- `apps/desktop/src/lib/projects/ProjectList.svelte` already reuses the shared
  session-row component for project sessions, but has a separate selection
  store and a dedicated view.
- `apps/desktop/src/lib/stores/projects.svelte.ts` automatically selects a
  project and creates a session when a project has none. Both behaviors conflict
  with the agreed navigation-only project toggle and must be changed.
- The project store also currently recreates an empty project session after
  deletion of the final active session; the agreed rule is to show an
  unselected empty state instead.
- The normal web API already offers a create-session endpoint returning a
  `New Session` summary, so the sidebar bug is likely client-side draft/list
  synchronization rather than a missing server capability.
- `ChatView.svelte` confirms the cause: `newConversation()` calls
  `chatStore.newConversationDraft(...)` rather than the create-session API.
  Its current channel state holds one expanded channel and one corresponding
  item list, so it cannot represent several independently expanded nodes.
- `ChatSessionStore.newConversationDraft()` is an in-memory draft operation.
  The implementation must replace it with a persisted-and-reused Web draft
  flow before changing the selected state.
- One search command included a non-existent `packages` path. No source was
  changed; subsequent searches will target existing roots only.
- A direct shell read of a bracketed Svelte route path failed because zsh
  treated brackets as glob syntax; all later route reads will quote these paths.

## Server and lifecycle detail

- Project session GET currently returns only id/title/time/origin and POST
  always creates a new session. It needs a server-owned idempotent
  create-or-reuse operation; the client cannot safely decide whether a session
  is empty from the current summary.
- Web session POST likewise always creates; its desktop client is only reached
  when the user sends the first message because `ChatSessionStore` maintains an
  unsaved draft.
- The shared desktop conversation query already filters project sessions out of
  ordinary Web conversations, exactly matching the required non-duplication
  rule.
- Project execution ownership is derived from session storage via
  `getConversationProjectId`, so keeping project sessions in the project store
  preserves the Agent's working directory context.

## Design constraints

- `DESIGN.md` identifies Geist and theme tokens; desktop UI changes need use
  existing shared UI/component patterns, support both themes, Chinese/English,
  keyboard focus, and mobile widths.
- Project rules require shared cross-channel logic to stay above channel
  adapters; only message transport and conversions belong in channels.

## Automation workspace refresh (2026-07-10)

- The chat Automation workspace currently embeds `TasksSection.svelte`, which
  was designed as a detailed settings surface: summary deck plus large cards
  and inline execution history. That is the source of the low list density.
- `ChatWorkspacePane.svelte` owns the workspace header and can replace only
  the Automation content without changing the separate Settings task surface.
- `ChatSidebar.svelte` does not receive the active workspace pane, so its
  Automation and Skills shortcut buttons cannot currently reflect selection.
- The existing desktop token set already supplies neutral surfaces, borders,
  focus treatment, and both themes. The new workspace should use those shared
  values and existing shadcn controls rather than introduce page-local styles.
- `TasksSection.svelte` is already in Svelte runes mode, so its new display
  variant must be received through `$props()` rather than legacy `export let`.

## Automation interaction and scheduling controls (2026-07-10)

- The workspace currently selects the first task through a derived fallback,
  which makes the detail pane open by default instead of behaving as an
  explicit selection.
- A single `tasksStore.busy` string gates every task action and every task-row
  control. This explains why pressing one task's Run button freezes all other
  tasks in the UI.
- Periodic task JSON has no persisted enabled flag and the scheduler has no
  paused-task guard, so pause/resume requires a small shared event contract
  extension rather than a UI-only switch.
- Fresh automation sessions are supposed to be classified from `origin` or a
  `task-` id in the shared desktop conversation query. The user screenshot
  shows an `[EVENT:...]` Web session leaking despite that invariant, so the
  execution/session creation path must be reproduced before changing filters.

## Automation interaction and scheduling controls — resolution (2026-07-10)

- The leaking `[EVENT:...]` rows came from the shared direct-event projection:
  it created a normal Web conversation without forwarding the `automation`
  origin. Persisting that origin at conversation creation lets the existing
  shared filter hide every automation session, regardless of its id format.
- A task's `enabled: false` value now remains in its watched event JSON. The
  watcher cancels any existing schedule and skips dispatch for that file;
  the task API rejects manual triggers while paused as an additional guard.
- The frontend now separates page-level destructive busy state from per-task
  running and update sets. This keeps concurrent task controls responsive and
  provides a stable local spinner for the task whose request is pending.
