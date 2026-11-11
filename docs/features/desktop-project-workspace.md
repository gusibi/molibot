# Desktop Project Workspace

The macOS Desktop app brings chat, project context, files, automations, and Settings into a native local workspace.

## What you can do

- Work in ordinary chats or attach conversations to a local project.
- Keep project sessions separate from ordinary personal conversations.
- Inspect project files, changes, and session attachments from the project workspace.
- Search project filenames or contents. Click a result or press Enter to preview it below the search results, keeping the query and list available for browsing other matches. Plain-text and code matches scroll to the matching line. Close search to return to the file tree while keeping the preview open.
- Use the same configured providers, Agent profiles, memory controls, and task tools available through the local runtime.

## Start here

1. Install and launch the macOS Desktop app.
2. Create or connect a local project directory.
3. Start a project conversation and use the file panel to inspect project context.

## Conversation recovery

Ordinary Desktop conversations, including project chats, keep the selected model during transient connection failures. Before a generation emits content, the runtime permits up to ten additional requests, with waits of about 2, 3, 5, 8 and then 10 seconds. A three-minute recovery deadline starts at the first failure and includes subsequent request time. Provider cooldown hints take precedence. If no first-token timeout is configured, Desktop uses 60 seconds.

The process row shows the retry count and countdown. Expand it to inspect the model and error; Stop cancels the wait. Recovered activities remain available after session switching or reload. Terminal errors use a short explanation with collapsed technical details.

App disconnections check the original task instead of submitting it again. If submission was never acknowledged, the input is restored and the user is warned to check the conversation before resending. Completed tools are retained. A generation that has already emitted text, thinking or tool-call content is not automatically replayed. Unknown external outcomes retain the existing recovery-review requirement.

If a disconnected task waits for approval, recovery retrieves the pending card before the task finishes and hands continuation to the approval flow. Queued follow-ups remain parked while approval is pending.

Browser requests without the Desktop marker, channel messages, scheduled work, Rooms, plan/task executions and child agents retain the existing retry policy. The strategy is recorded with execution admission and approval suspension; opening another surface does not change it.

Validation uses temporary stores, production Runner regressions and an isolated Desktop preview with a local model service. Installed native App and real Provider verification are separate acceptance steps.

## Boundaries

The Desktop app is macOS-specific. It manages local projects and local runtime connections; it does not replace source control or make external services available without configuration.

## Related documentation

- [Project session provenance (archived)](../archive/requirements/project-session-provenance-and-inspection.md)
- [Project Skills loading (archived)](../archive/requirements/project-skills-loading.md)
- [macOS app requirements (archived)](../archive/requirements/molibot-macos-app-plan.md)
