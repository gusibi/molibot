# Project 自动任务 PRD

> 状态：Delivered
> 日期：2026-08-16
> 范围：共享 Agent Runtime、watched event 调度、Desktop 自动任务工作区、Desktop Project 设置
> 架构术语：Runtime Task、Runtime Event、Project、Project Runtime、Session、Execution

## Problem Statement

Molibot 的 Project 已经能够让 Agent 在一个真实工作目录中运行，加载该目录的工作规范、Project Skills、Project Memory、默认模型、思考等级、Sandbox 和 Project Runtime Workspace。用户可以在 Desktop App 的 Project Chat 中手动发送消息，获得带完整项目上下文的 Agent 执行结果。

现有 Runtime Task 只能绑定到 Web、Telegram、飞书、QQ、微信等 Channel/Bot 目标，或由 Molibot 作为内部系统任务执行。用户无法创建一个原生绑定 Project 的周期自动任务。因此，诸如“每天总结这个工作 Project 中的待办、邮件和当天进展”这样的任务，要么被迫挂在某个 Bot 上，要么只能在普通 Web 自动任务提示词中手工写目录路径。两种办法都不能保证使用 Project 当前的工作规范、Skills、Memory、模型、Sandbox 和独立 Runtime Workspace，也不能把结果稳定地留在 App 的 Project 自动任务入口中。

用户需要 Project 成为 Runtime Task 的一级执行目标：任务按现有 watched event JSON 和 Runtime Event 系统调度，触发时像在 Project 中发送一条消息一样运行 Agent，复用当前 `fresh` Session 语义，在 App 中保存并查看每次 Execution，且绝不向任何外部 Bot 或 Channel 发送结果。

## Solution

在现有 Runtime Task 聚合中增加 Project 执行目标。Project 自动任务仍然是 `periodic` Runtime Task，不新增任务类型、不新增任务数据库，也不复制调度器。

用户可以从两个入口管理同一份 Project Runtime Task：

1. Desktop 自动任务工作区新增“Project”分类，聚合展示所有 Project 周期自动任务。
2. Project 设置新增“自动任务”Tab，只展示并管理当前 Project 的周期自动任务。

任务触发时，共享 Task Scheduler 通过 Project watched-event 目录取得执行租约，解析 Project 当前配置，进入现有 Project Runtime，使用 Project root 作为工作目录，并加载与 Project Chat 相同的工作规范、Skills、Memory、模型、思考等级、Sandbox 和工具权限。执行复用现有 `fresh` 语义：稳定 taskId 复用该任务的隐藏 fresh archive，每次触发拥有独立 Execution、runId 和 run-scoped transcript 投影。结果只持久化到 App 可读取的 Project Runtime 和 Runtime Task 执行记录，不调用任何 Channel 出站能力。

## User Stories

1. As a Project owner, I want to create a periodic automation inside a Project, so that recurring work can use that Project's real context.
2. As a Project owner, I want the task to run from the Project root, so that relative file references behave exactly like a manual Project message.
3. As a Project owner, I want the task to follow the Project's current AGENTS.md, AGENT.md, or CLAUDE.md rules, so that automated and manual work obey the same operating instructions.
4. As a Project owner, I want the task to load Project Skills, so that recurring workflows can use capabilities installed specifically for that Project.
5. As a Project owner, I want the task to use Project Memory, so that summaries and recommendations have the same Project-scoped knowledge as Project Chat.
6. As a Project owner, I want the task to use the Project's current model and thinking defaults, so that changing Project settings affects future runs without editing every task.
7. As a Project owner, I want the task to use the Project's current Sandbox and permission configuration, so that unattended execution never bypasses Project safety policy.
8. As a Project owner, I want each trigger to use the existing fresh automation semantics, so that ordinary Project conversations are not polluted with recurring prompts.
9. As a Project owner, I want every trigger to create an independent Execution with its own runId, so that I can distinguish daily results even when the task reuses its fresh archive.
10. As a Project owner, I want to open the transcript for a specific Execution, so that the App shows only the messages and outcome associated with that run.
11. As a Project owner, I want the result to stay in the App, so that a work summary is not sent to Telegram, Feishu, QQ, Weixin, or any other Bot.
12. As a Project owner, I want Project tasks to remain executable when no external Bot is configured, so that Project automation is an App capability rather than a Channel capability.
13. As a Project owner, I want to see all Project automations in the global automatic-task workspace, so that I can monitor recurring work across Projects in one place.
14. As a Project owner, I want Project automations clearly separated from ordinary Bot automations, one-shot reminders, and Molibot system tasks, so that their ownership and execution environment are unambiguous.
15. As a Project owner, I want every task row to show the Project name, schedule, enabled state, latest outcome, and last run time, so that I can assess it without opening details.
16. As a Project owner, I want to search Project automations by task text and Project name, so that large task inventories remain manageable.
17. As a Project owner, I want to create a Project automation from the global automatic-task workspace, so that I can choose any registered Project as its target.
18. As a Project owner, I want to create a Project automation from Project settings without choosing the Project again, so that the local workflow is concise and mistake-resistant.
19. As a Project owner, I want to edit task instructions, schedule, timezone, and enabled state from either entry, so that both views manage one source of truth.
20. As a Project owner, I want to trigger a Project automation immediately, so that I can validate its prompt and environment before waiting for the next schedule.
21. As a Project owner, I want to stop a running Project automation, so that an incorrect or expensive run can be terminated from the App.
22. As a Project owner, I want to delete a Project automation from either entry, so that obsolete workflows disappear everywhere at once.
23. As a Project owner, I want concurrent triggers of the same task to be skipped instead of duplicated, so that the same unattended workflow cannot overlap itself.
24. As a Project owner, I want retries, timeouts, interruption recovery, and execution history to use the existing Runtime Event lease semantics, so that Project tasks have the same reliability guarantees as current automations.
25. As a Project owner, I want a missing or inaccessible Project directory to produce a visible failed Execution, so that a moved directory never silently falls back to a Bot workspace.
26. As a Project owner, I want a deleted Project's tasks to stop being dispatchable, so that orphaned schedules cannot run against an unintended location.
27. As a Project owner, I want Project task files and runtime metadata stored under Molibot's data directory, so that Molibot never writes scheduling metadata into the real Project root.
28. As a Project owner, I want deleting a Project or its task to never delete Project root contents, so that task lifecycle operations cannot damage my work directory.
29. As a Project owner, I want approval-requiring tools to suspend cleanly and surface their approval in the App, so that unattended work does not hang forever or bypass consent.
30. As a Project owner, I want approving a suspended Project task to resume with the same Project Runtime context, so that cwd, Skills, Memory, model, and permissions do not drift during resume.
31. As a Project owner, I want the next scheduled trigger to remain eligible after a prior run suspended for approval, so that one pending approval cannot permanently block the task.
32. As a Project owner, I want generated files and attachments to remain associated with the Project Execution, so that I can inspect its output through existing App artifact surfaces.
33. As a Project owner, I want Project task run details and tool activity to use the existing Project transcript renderer, so that manual and automated Project work look and behave consistently.
34. As a Project owner, I want task status to come from the execution lease rather than stale event-file locks, so that crashed runs never display as permanently running.
35. As a Project owner, I want a paused Project task to remain listed but never dispatch, so that I can temporarily disable recurring work without losing its configuration.
36. As a Project owner, I want schedule edits to reset the task to an idle pending state without deleting history, so that configuration changes preserve auditability.
37. As a Project owner, I want task timestamps and schedules displayed in my configured locale and timezone, so that execution timing is understandable.
38. As a Project owner, I want Project automation controls to work in Chinese and English, Light and Dark themes, and narrow Desktop widths, so that the feature matches the rest of the product.
39. As a keyboard user, I want Project settings tabs, task lists, dialogs, menus, and schedule controls to remain keyboard accessible, so that no operation requires a pointer.
40. As a Project owner, I want the Project settings save footer to remain fixed for Project configuration changes, while task mutations commit through task-specific actions, so that unrelated Project fields are never overwritten by task CRUD.
41. As a Project owner, I want Project settings changes and task changes to use separate fine-grained APIs, so that editing a schedule cannot overwrite Project configuration and saving Project settings cannot rewrite tasks.
42. As a Project owner, I want the currently selected Project task list to reject stale responses from a previously selected Project, so that fast Project switching cannot show or mutate the wrong tasks.
43. As a Project owner, I want Project task completion to refresh the visible task state and Project-related execution surfaces, so that results appear without restarting the App.
44. As an operator, I want logs to include taskId, projectId, runId, sessionId, execution status, and failure reason, so that a failed unattended run can be diagnosed end to end.
45. As an operator, I want manual trigger and scheduled trigger to use the same Project execution function, so that testing “Run now” proves the production schedule path.
46. As an operator, I want Project task persistence tests to use temporary data directories and databases, so that automated tests never touch real user settings, sessions, events, or Project data.
47. As an operator, I want the scheduler to continue using watched event JSON instead of an OS scheduler, so that Runtime Tasks retain one execution and recovery model.
48. As an operator, I want the App to state that Molibot Runtime must be running for a periodic slot to fire, so that local scheduling limitations are not mistaken for cloud execution guarantees.
49. As a maintainer, I want Project to be a target of the existing Runtime Task aggregate rather than a new task type, so that task CRUD, status, history, and scheduling logic remain shared.
50. As a maintainer, I want Channel adapters to remain unchanged by Project orchestration, so that adding or modifying a Channel never requires implementing Project scheduling.

## Implementation Decisions

- `Runtime Task` remains the sole user CRUD aggregate defined by ADR 0003. Project automation is a user-managed `periodic` Runtime Task with a Project execution target; it is not a new task type, Durable Execution, Notification, Mini App Todo, or Molibot-managed system task.
- Runtime Task configuration remains watched event JSON. Runtime Event execution ownership, retries, timeouts, interruption recovery, concurrent-run suppression, status history, and run/session linkage continue to use the existing execution lease store.
- Project task JSON is stored under Molibot's Project workspace in the data directory, never under the registered Project root. The canonical location is the Project workspace's `events` directory next to its `runtime` and `sessions` data.
- The event contract becomes target-aware through a discriminated execution target. Existing Channel and internal events keep their current representation and behavior; new Project tasks carry a Project target identified by `projectId` and do not require a synthetic Bot or external chat recipient.
- Project task path authorization is explicit and based on registered Project IDs plus the canonical Project workspace path. API callers continue to receive opaque task IDs rather than absolute filesystem paths.
- The shared Task Scheduler owns Project watcher registration and dispatch. It enumerates registered Projects at startup and refreshes Project watcher ownership after Project/task CRUD changes. Channel implementations receive no Project-specific scheduling logic.
- Project dispatch has one shared application-layer executor used by scheduled triggers and “Run now.” The executor validates the Project and root directory, resolves the current Project Runtime, runs the Agent, persists the result, and returns the execution outcome without calling a Channel manager.
- The Project executor reads Project configuration at execution time. Task JSON stores only the stable Project target and task configuration; it does not snapshot Project instructions, model, thinking level, Sandbox, Skills, Memory, or root path.
- Project execution reuses the same Project context builder and process-wide Project Runtime cache as Project Chat. This preserves Project cwd, prompt/profile merge order, Skills, Memory namespace, model overrides, thinking level, Sandbox, permissions, artifact paths, run details, and approval resume semantics.
- Project automation uses the existing `fresh` Session mode without introducing a new Session mode. A stable taskId may reuse the existing hidden fresh archive; every trigger remains a separate Execution and runId, and transcript reads are scoped by execution runId.
- Project task archives remain excluded from ordinary human Project conversation lists. They are discoverable from the Project automatic-task Tab and global Project automatic-task category, where each Execution can open its run-scoped transcript. This preserves the existing rule that automation contexts do not leak into ordinary conversation navigation.
- The execution lease records the resolved fresh archive Session ID. Project task history uses projectId, taskId, executionId, sessionId, and runId to locate the Project Runtime context safely.
- Project task delivery is App-only persistence. `delivery=agent` continues to mean “run the Agent”; notification destination is not inferred from that field. Project dispatch never invokes Channel `sendText`, `respondInThread`, upload, or internal-notice methods.
- Project task lease scope is Project-owned and stable, so duplicate suppression is independent of Channel/Bot scopes. Two different Project tasks may run concurrently; two active triggers of the same task are not allowed.
- Timeout and explicit Stop abort the exact Project runner identified by the execution's Project/session/run ownership. They do not call Channel abort helpers.
- A Project missing from the registry or with a missing/inaccessible root fails closed. It never falls back to Web/Bot runtime or scratch cwd. The failure is persisted to the execution lease and shown in task history.
- Deleting a task removes only its watched event JSON. Deleting a Project follows the existing Project deletion contract and never touches rootPath. Project deletion also prevents orphan task dispatch; deletion of Project workspace data follows the existing explicit `removeSessions` owner choice.
- Project settings uses two semantic Tabs: General and Automations. General retains the existing Project form and fixed save footer. Automations is a task workspace whose mutations use task-specific APIs and do not submit the Project settings form.
- The global automatic-task workspace adds a Project category alongside user periodic automations, one-shot reminders, and system tasks. Project rows include project identity and never masquerade as a Web Channel target.
- Both Desktop entries use the same task store, API contract, schedule builder, list/detail presentation, history loader, transcript renderer, status labels, confirmation patterns, and mutation actions. The Project settings entry applies a locked projectId filter and a Project-targeted create draft rather than duplicating CRUD code.
- The Desktop task contract exposes Project target metadata as a discriminated target and adds project identity to task items. Category is a view projection, not the source of execution truth.
- The shared task inventory collects Channel, system, and Project watched-event roots into one credential-safe projection. Counts include Project tasks as a distinct user-facing category without changing underlying periodic type totals.
- Task session loading resolves workspace and chat/context ownership from structured task target metadata. It no longer infers every task's runtime solely from Channel directory markers.
- Project task create/update/delete/trigger APIs remain fine-grained. They never patch the entire Runtime settings object or Project record.
- Project and task list async responses carry request generation and owner Project ID before mutating visible Desktop state.
- UI implementation follows DESIGN.md: shared semantic controls, existing schedule builder, theme tokens, bilingual copy, responsive list/detail behavior, keyboard semantics, and no new page-local style system or custom switch.
- Local scheduling continues to require a running Molibot Runtime. Periodic missed-slot catch-up after a completely offline interval is not added by this PRD; the UI/help copy must not imply cloud execution.
- No backward-compatibility layer or migration is required because Project-targeted Runtime Tasks do not exist in prior versions. Existing Channel/system task files remain valid through their existing paths and code paths.

## Testing Decisions

- The primary acceptance seam is one high-level Project Runtime Task execution scenario. A test creates a temporary Project registry record and Project root, writes a Project periodic watched event, triggers the same dispatcher used by the scheduler and “Run now,” then verifies: an execution lease is completed; a fresh automation Session/archive is attached; Project rules and cwd reach the runner; run-scoped transcript content is readable from the Desktop task API; and no ordinary Channel trigger or delivery method is called.
- Tests assert external behavior and persisted outcomes rather than private helper calls. The primary test should remain valid if watcher registration, executor internals, or UI composition are refactored.
- Scheduler tests cover Project watcher registration, missing Project failure, paused task retention, duplicate active trigger skipping, retry/timeout settlement, interruption recovery, and scheduler restart without duplicate watchers.
- Project executor tests cover current Project configuration resolution, missing root fail-closed behavior, Project Runtime selection, fresh archive reuse across executions, distinct execution/run IDs, execution-to-session attachment, App-only persistence, exact abort ownership, and approval suspension without an occupied lease.
- Task inventory/API tests cover Project task discovery, opaque path handling, create/update/delete/trigger, Project identity projection, global counts, projectId filtering, history pagination, and run-scoped session loading from the Project Runtime.
- Desktop contract/API tests cover normalization of Project targets and tasks, request payloads for Project create/update actions, and rejection of stale responses after endpoint or Project changes.
- Desktop UI structural tests cover the fourth global category, General/Automations Project settings Tabs, locked Project target creation, shared schedule builder/editor/history/transcript reuse, no Channel target controls inside Project settings, fixed General save footer, bilingual labels, and absence of native select or custom switch regressions.
- Existing prior art is reused: watched event and lease tests for scheduling/recovery, Project Runner routing tests for runtime ownership, task-session tests for fresh archives, Desktop tasks tests for inventory/status/history, Desktop API tests for credential-safe contracts, and chat UI structural tests for Svelte integration.
- Persistence tests use temporary data directories, temporary Project roots, injectable Project/session/event lease stores, and temporary SQLite files. Tests must never read or write the user's settings.sqlite, event lease database, sessions, queue, Project workspace, or runtime data.
- Verification includes targeted Node tests, TypeScript diagnostics, Desktop Svelte checking, production builds, Desktop structural tests, and `git diff --check`.
- Because this changes UI and Desktop runtime behavior, cold-start smoke acceptance restarts the service, opens Automations for the first time, opens a Project and its Automations Tab, runs a task, switches Project/Session, interrupts and restores the service, and confirms the task/history/session projection recovers without blank-first-open or stale-owner bugs.

## Out of Scope

- New Runtime Task types beyond existing todo, one-shot, periodic, and internal immediate events.
- A new Project Task database, OS scheduler, crontab, launchd task, cloud scheduler, or Memory-based scheduling fallback.
- Periodic missed-slot catch-up after the Molibot Runtime was completely offline.
- Sending Project task output to Telegram, Feishu, QQ, Weixin, email, webhook, or any other external notification destination.
- Per-task snapshots or overrides for Project root, instructions, Skills, Memory, Sandbox profile, approval profile, model, or thinking level.
- A new Session mode or changing fresh semantics for existing Channel automations.
- Showing automation archives in the ordinary Project conversation tree.
- One-shot Project reminders, unscheduled Project todos, Event-driven file watchers, git hooks, or Project task dependencies.
- Cloud execution when the owner's machine and Molibot Runtime are offline.
- Parallel overlapping executions of the same Runtime Task.
- Refactoring unrelated Channel automation implementations, Project Chat UI, Durable Execution, Mini App Todo, or the global settings information architecture.
- Automatic email/provider account setup. A Project task may use already configured tools and connectors, subject to their existing permissions.

## Further Notes

- “Project 自动任务” is the user-facing name. `Runtime Task` and `Runtime Event` remain architecture terms.
- Project is an execution target, not a task type and not a Channel. This distinction must remain visible in contracts, logs, UI labels, and tests.
- `fresh` means the existing Molibot automation behavior, including stable per-task archives where applicable. Product copy should describe runs as separate execution records rather than promising a brand-new visible conversation for every trigger.
- The user's core example is a work Project that periodically summarizes daily todos, mail, and progress. The capability does not hard-code that workflow; it supplies the Project-native scheduled execution environment needed for it.
- A Project task that needs an unavailable connector or approval should fail or suspend through the existing runtime semantics and leave a diagnosable App record. It must never silently deliver partial output to an external Bot.
- The implementation is complete only when scheduled and manual triggers share one execution path and the high-level seam proves App-only Project Runtime execution end to end.

## Delivery Verification

- Project task CRUD, watched-event discovery, manual dispatch, Project Runtime routing, hidden automation Session ownership, and App-only execution are covered with temporary data directories and SQLite stores.
- The focused backend/contract suite passes 120/120; Desktop structural UI coverage passes 207/207; Desktop `svelte-check` reports 0 errors and 0 warnings.
- Root and Desktop production builds pass. A real cold-start smoke path verified the global Project category, Project Settings → Automations, the locked local Project target, and the global Project selector; all smoke-test data was removed afterward.
