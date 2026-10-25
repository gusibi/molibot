# ADR 0006: Agent Handover is a projection, not a conversation

## Status

Accepted — 2026-10-23. Implemented 2026-10-23 for `PA-HD1`–`PA-HD10`, `PA-HD12`, `PA-HD13`; `PA-HD11` remains future work.

The [work-home UI specification](../designs/agent-home/personal-agent-dashboard-ui-spec.md), dated 2026-10-25 and not yet implemented, extends the target presentation to reports, topic proposals, decisions and task execution. It revises the historical-window and result-scope rules for that UI while retaining this ADR's projection and fixed-context ownership decisions. The existing implementation remains governed by its delivery specification until the new UI ships.

## Context

The Desktop home is the first screen most users see each day. After Personal Agent V1 it showed an identity block, a composer, three quick-start prompts and three recent conversations. That answers "who am I talking to", not "what happened while I was away".

The reference behaviour users expect from personal agents is the assistant speaking first: a short account of what it did, with the evidence attached and the pending decisions inline — the pattern popularised by Muse-style apps. That pattern is normally implemented as one permanent thread shared with the assistant.

Molibot cannot copy that thread literally. Personal Agent V1 fixes a Session's owning Agent at first send (PA-I1), refuses to create history before the first send (PA-U2), and explicitly does not introduce a permanent main conversation. A permanent thread would also have to answer which Agent owns it, which model context it holds, how it is compacted, and whether channel sessions feed it.

## Decision

1. **The handover is a projection.** It is assembled from runtime evidence — traced runs, runtime task executions, durable execution state, pending approvals — at read time. It carries no Agent Context, owns no messages, and is not a Session. Typing and sending from the home still creates a new Session under PA-U2.
2. **It belongs to the Default Agent's home only.** Other Agents keep the "start a conversation" home. The handover represents "your assistant has been watching the whole picture", which is the Default Agent's role.
3. **The window starts at the user's last acknowledged view.** `lastAcknowledgedAt` is written when the user leaves the home, not when they open it, so glancing at the page and closing it cannot consume events. Pending decisions ignore the window entirely: they are live state, not history.
4. **Only decisions float across Agents.** Completed work is attributed to the Agent that produced it; anything waiting on the user is listed regardless of which Agent, Project or Room raised it, labelled with its source. Identity fields on approval payloads come from the single execution-identity resolver (PA-I7), never from inline channel-binding reads.
5. **Facts are templated; prose may be polished.** Counts, times and sources are generated from events. A model may reword an explanation for an anomaly, but may never change a number, a time or a source, and never describes work that did not happen.
6. **Open Loops use observable signals only.** An unopened deliverable, a thread where the Agent replied last, or a durable execution explicitly waiting on the user. No model judgement about what the user is "still thinking about".
7. **Approval state is single-sourced by `requestId`.** The handover and the source Session render the same state; resolving in either place removes it from both, and repeated resolution is idempotent.
8. **Retention is one generation deep.** The latest handover plus the previous one. No history list until a separate requirement asks for it.

## Alternatives considered

- **A permanent main thread (Muse-style literal copy).** Rejected: it contradicts fixed Session ownership and first-send creation, needs a model context with no clear owner, and would compete with compaction and channel isolation.
- **Activity Feed / dashboard.** Rejected: already out of scope for V1, and it optimises for monitoring rather than for handing work back.
- **Generated once per day on a schedule.** Rejected: the anchor would drift from when the user was actually away, so the page would claim "the last 9 hours" hours after the user returned.
- **Model-generated daily summary.** Rejected: daily inference cost plus a real fabrication risk on the one screen whose value is being trustworthy.
- **A handover per Agent.** Rejected: the page would change shape on every Agent switch, and site-wide approvals would have an arbitrary home.

## Consequences

- The home stops being purely a conversation entry point. Users who came to type still can, but the first thing they read is a report; the transition into a new Session after sending must be deliberate.
- Identity for each waiting item is resolved at composition time by the handover read model, using raw records that still carry a session — the four existing approval/execution endpoints keep their payloads unchanged.
- New persisted state (`lastAcknowledgedAt` plus one frozen previous generation) is required before the page can be honest about its window.
- The handover cannot be resumed as a conversation. "Continue that discussion" has to go through the source Session or a new Session — that path must stay reachable from the page.
- Because the design depends on runtime evidence rather than stored prose, a later change to what counts as a result event changes history retroactively. Only the latest and previous generations are retained, which bounds the damage.
