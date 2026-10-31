# Personal Agent and Memory

Molibot is built for an Agent that works with you over time, not a chat that starts from zero every session.

## What it helps with

- Keep conversations and session state available across Web, Desktop, and supported chat channels.
- Retain governed memories about preferences, projects, and working context.
- Show which memories entered a completed turn and let you review or suppress future use.
- Keep Agent, project, and ordinary conversation contexts separate so one role does not silently inherit another role's work.

## Start here

1. Configure a provider and create an Agent in Settings.
2. In Desktop, the default Agent appears first. Global New chat uses it; each enabled Agent’s + button starts that Agent’s draft. Select an Agent to open its home, then send the first message to create a Session. Expand its history independently, or open Full history for archived sessions and source filters. Web continues to use configured Web Profiles.
3. Review saved and pending memories from the Memory settings area.

## Ordinary Session identity

The first message fixes the Session’s Agent. Session model overrides take precedence over the current Agent’s default and then the global default. Each Agent keeps its own new-chat draft. Restarting restores the last selected page or Session.

Settings → Agents controls the default Agent, avatar, description, sidebar visibility, enabled state and owner memory sharing. A disabled Agent retains readable history but cannot start new turns or scheduled attempts. Deletion requires resolving channel/task references and pending work; ordinary history is archived and the deleted ID cannot be reused. Private memories remain stored but are excluded from other Agents.

Unknown historical ownership is never guessed. Use Desktop’s explicit claim action before continuing an unassigned local Session. External mirrors can be classified by Agent while remaining read-only. The standalone Web page has no claim control; an unknown old Web Session must first be claimed from Desktop.

## Boundaries

Memory is configurable and reviewable. It is not a claim that every conversation will be remembered forever, and it should not replace source documents or project history.

- **Memory navigation and uncollected records**: Desktop Memory is organized into four views: Overview, Topics, All Memories, and Uncollected (`概览、主题、全部记忆、未收录`). Uncollected (`未收录`) lists inputs that did not pass write checks (ordered by content, rejection reason, source, write action, and timestamp, with search across content/reason/source and matched/loaded counts) and states explicitly that they do not participate in recall; Advanced Management holds status and maintenance actions only, without duplicating the memory or uncollected lists.
- **Overview reading and review**: The profile initially shows a 180-character preview; expand it to read the full returned profile and its selection metadata. Pending candidates have a counted disclosure above the reading panels. Empty focus, attention, recent and preference panels are omitted. Recent memories and stable preferences show three entries each with a path to All Memories; preference entries open their memory editor. Maintenance and vector-model navigation stay separate from the view tabs.
- **Per-record vector status**: Desktop All Memories displays the database-backed embedding presence per record (`已有向量 / 未生成向量 / 向量状态未知`) using the shared status badge rather than inferring vector presence from model configuration or service availability. Running backfill from Advanced Management refreshes All Memories on completion.

## Related documentation

- [Memory usage, trace, and feedback design](../designs/memory/memory-usage-trace-and-feedback.md) (delivered)
- [ADR 0001: memory namespace and turn-retention semantics](../adr/0001-memory-namespace-and-turn-retention.md)
- [Memory improvement plan v3 (archived)](../archive/requirements/memory-improvement-plan-v3.md)
- [Project session provenance (archived)](../archive/requirements/project-session-provenance-and-inspection.md)
- [Personal Agent V1 requirements and acceptance](../requirements/personal-agent-experience-v1.md)
- [Delivered changes](../../features.md)
