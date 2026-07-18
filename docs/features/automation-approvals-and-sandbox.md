# Automation, Approvals, and Sandbox

Molibot can run scheduled work, but automation stays visible and controlled. Tasks, approvals, execution records, and sandbox policy are part of the same local runtime.

## What you can do

- Create recurring and one-time tasks from the Desktop automation workspace.
- Review task status and execution history.
- Require approval for actions that need host-level access.
- Configure sandbox policy at the appropriate runtime scope.
- Stop or recover visible work when a run does not finish normally.

## Start here

1. Configure an enabled Bot and a delivery destination.
2. Create a task from the Automations workspace.
3. Review the task's run history and approval state before enabling broader access.

## Boundaries

Automations are not a license for unattended external publishing. Keep destructive, credential-bearing, or public actions behind explicit review until you have validated the full workflow in your own environment.

## Related documentation

- [Daily materials guide](../guides/daily-materials.md)
- [Sandbox research](../research/sandbox/subagent-sandbox.md)
- [Event retry design](../designs/agent-runtime/event-run-timeout-retry.md)
