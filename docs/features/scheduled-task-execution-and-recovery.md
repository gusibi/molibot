# Scheduled Task Execution and Recovery

Every automation in Molibot runs on your own machine, in a process that can be restarted, updated, or killed at any moment. This page explains what a scheduled task is made of, what each status in the Automations workspace actually means, and what happens to a run that was in flight when the service went away.

If you only want the short version: **a task that was interrupted is reported as interrupted, not as running.** It is resumed automatically only if it can still be resumed usefully, and otherwise it waits for its next scheduled time.

## The two records behind a task

A task is stored in two places, and they answer different questions.

| | Task file (`<data-dir>/<channel>/bots/<bot>/events/*.json`) | Execution record (SQLite `event_execution_leases`) |
| --- | --- | --- |
| Holds | The task **definition**: schedule, text, timezone, delivery mode, plus a small run **lock** | One row per **attempt**: start and finish time, attempt number, session id, error, result, owning process |
| Lifetime | One per task, edited when you edit the task | Appended on every run, kept as history |
| Answers | "When should this run?" and "is this minute's slot already taken?" | "Did the last run succeed?", "how many attempts?", "who was running it?" |

The distinction matters for one reason worth stating plainly: **the `status` field inside the task file is a lock, not a result.** A successful recurring run writes it back to `pending`, because the task is once again simply waiting for its next slot. It therefore cannot tell you whether the last run succeeded — only the execution record can, and that is what the UI reads.

## Statuses you will see

The headline state of a task in the Automations workspace is derived from its most recent execution, never from the file's lock:

| Status | Meaning |
| --- | --- |
| **Running** | An execution is genuinely held by a live run in the current process. |
| **Completed** | The last attempt finished successfully. A recurring task stays in this state until its next slot. |
| **Failed** | The last attempt ended in an error, was stopped, or exhausted its retries. |
| **Interrupted** | The service stopped while this attempt was in flight — a crash, a restart, an upgrade, or quitting the app. The task itself is not necessarily broken. |
| **Paused** | The task is disabled and will not be scheduled at all. |
| **Not run yet** | The task exists but has no execution history. |

Each task row also shows the outcome and start time of its last run, and the detail pane lists recent attempts with links to the session each one produced.

## A normal run

1. The scheduler matches the cron expression and claims the minute's slot in the task file, so a second dispatch of the same minute cannot start.
2. It acquires an execution lease in the database, stamped with the current process's identity.
3. The agent runs, bounded by the execution timeout.
4. On success the lease is marked completed and the task file returns to `pending`, ready for the next slot.

If the run exceeds its timeout, the runtime asks it to cancel, waits a short settlement window, then records a timeout and retries after the retry delay, up to the configured attempt cap. This is retry *within a single run of the service*.

## When the service stops mid-run

This is the case that used to leave a task spinning forever. Restart reconciliation now happens in two steps, in this order.

### Step 1 — the database decides what was alive

Every lease records the identity of the process that acquired it. On startup, any lease still marked `running` whose owner is **not** the current process is orphaned by definition: the only thing that advances a running lease is an in-process timer, and that timer died with its process. Those leases are reclaimed as `interrupted`.

Note what is *not* used here: elapsed time. "It only started 30 seconds ago, so it must still be alive" is precisely the reasoning that fails after a crash, and reclaiming on age alone left interrupted runs pinned as active — which in turn suppressed every future run of that task, because a task with an active lease is skipped.

### Step 2 — the task file is reconciled

Every task file still claiming to be running is then matched against the outcome of that slot in the database, and moved to a state that reflects reality:

| Lease outcome for that slot | What happens to the task |
| --- | --- |
| Interrupted, inside the catch-up window | The run resumes and finishes, continuing the same attempt rather than opening a new slot |
| Interrupted, past the catch-up window | Reported as interrupted; the task waits for its next scheduled time |
| Awaiting retry | The retry is picked up and executed |
| Failed / stopped / completed | The task is moved to the matching final state |
| No record at all | Reported as interrupted, so nothing is left claiming to run |

There is deliberately no "leave it alone and hope" path. A task file stuck at `running` is not merely a wrong badge — it also blocks the next scheduled dispatch.

## Catch-up: bounded on purpose

An interrupted run is resumed automatically **only if less than 30 minutes have passed since it was scheduled to start** (configurable, see below). Past that, it is reported and skipped.

The reason is that scheduled tasks have effects in the world. They send messages, publish posts, call external APIs. A daily report that was interrupted at 08:30 and silently replayed when you reopened the app at 22:00 is worse than one that was skipped: the recipient gets stale content at the wrong hour, and anything the run had already published before dying may be published twice.

If you do want an interrupted run to happen anyway, trigger it manually from the task's detail pane. That is an explicit decision with a person behind it, which is the right shape for an action that has already partially happened once.

## Two different retries

These are easy to confuse, so they are named separately:

- **Timeout retry** happens inside one run of the service. The attempt exceeded `executionTimeoutMs`, so it is cancelled and retried after `retryDelayMs`, up to `maxAttempts`.
- **Restart catch-up** happens when the service starts. The attempt never got to finish because the process ended, and it is resumed only inside the catch-up window.

An interrupted attempt that is caught up continues the *same* execution record with its attempt counter incremented; it does not open a new slot, and it does not reset the attempt budget.

## Configuration

Task execution settings live in runtime settings under `events`, and each has an environment-variable default:

| Setting | Default | Environment variable | Controls |
| --- | --- | --- | --- |
| `executionTimeoutMs` | 10 min | `MOLIBOT_EVENT_EXECUTION_TIMEOUT_MS` | How long one attempt may run before it is cancelled |
| `maxAttempts` | 3 | `MOLIBOT_EVENT_MAX_ATTEMPTS` | Timeout retries per slot |
| `retryDelayMs` | 5 s | `MOLIBOT_EVENT_RETRY_DELAY_MS` | Wait between timeout retries |
| `taskSessionRetentionDays` | 7 | `MOLIBOT_EVENT_TASK_SESSION_RETENTION_DAYS` | How long task sessions are kept before pruning |

Recovery behaviour is tuned through environment variables only:

| Environment variable | Default | Controls |
| --- | --- | --- |
| `MOLIBOT_EVENT_CATCHUP_WINDOW_MS` | 30 min | How late an interrupted run may still be resumed automatically. `0` disables catch-up entirely |
| `MOLIBOT_EVENT_RUNNING_TTL_MS` | 15 min | How long a task file's run lock is honoured before the scheduler considers the slot re-dispatchable |
| `MOLIBOT_EVENT_RUNNING_LOCK_ENABLED` | `true` | Whether recurring dispatch takes the file run lock at all. Leave this on |

## Troubleshooting

**A task shows "Interrupted".** The service stopped while it was running. Check the crash reports in `<data-dir>/runtime/crashes/` if this was unexpected; each one names the fault that ended the process. The task itself needs no repair — it will run at its next scheduled time, and you can trigger it now if the missed run still matters.

**A task shows "Interrupted" repeatedly.** That points at the service, not the task. Repeated crashes at the same point in a run usually mean the run itself is triggering the fault; the run's session transcript and the crash report together will name it.

**A task has not run since a specific date.** Open its run history. If the newest entry is much older than the schedule implies, the task was disabled, its Bot or destination was removed from the allow-list, or its channel is not configured — a task whose delivery target no longer exists is never dispatched.

## Design invariants

These are the rules the implementation is held to, and the reasons a change here needs care:

- **Liveness is ownership, not age.** Only the identity of the owning process may be used to decide whether a run is still alive across a restart.
- **A lock cannot report a result.** The displayed state is derived once, in the shared projection layer, from the execution record.
- **No branch may quietly do nothing.** Any code that inspects a task claiming to run must leave it in a terminal state.
- **Automatic replay of a side-effecting task is time-bounded.** Beyond the window, a person decides.
- **Diagnostics must not be able to end the service.** Writing a log line or rendering streaming progress is best-effort; failing to do either is never fatal.

## Related documentation

- [Automation, Approvals, and Sandbox](automation-approvals-and-sandbox.md)
- [Event run timeout, abort, and retry design](../designs/agent-runtime/event-run-timeout-retry.md)
- [Daily materials guide](../guides/daily-materials.md)
