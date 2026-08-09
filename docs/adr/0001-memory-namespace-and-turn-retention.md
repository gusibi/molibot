# ADR 0001: Canonical memory namespace and turn-retention semantics

## Status

Accepted

## Context

Personal facts could be written to a chat or content namespace while ordinary recall read owner memory. Separately, transcript persistence, future model context, conversation search, and memory reflection had no shared per-turn contract, so “only this turn” could still be recovered through another projection.

## Decision

Durable user facts/preferences default to the owner namespace, or the current project namespace inside a project. Chat namespaces remain authorized retrieval boundaries; content and Agent namespaces keep their specialized meanings.

Every user turn receives one persisted policy:

| Policy | Future Agent Context | Conversation search | Memory/reflection |
|---|---:|---:|---:|
| `standard` | yes | yes | yes |
| `no_memory` | yes | yes | no |
| `not_searchable` | yes | no | no |
| `turn_only` | no | no | no |

The policy applies to the user message, assistant messages, and tool-loop entries from that run. “Delete” remains a separate target-specific, non-cascading operation: conversation deletion must tombstone search projections; memory deletion must suppress re-import. Removing both a source turn and a derived memory requires naming both targets.

## Consequences

- A personal memory written from Web can be recalled from another authorized channel.
- A visible transcript is no longer proof that its content is eligible for context, search, or memory.
- Stronger privacy policies intentionally imply the weaker restrictions, preventing memory search from bypassing “not searchable”.
- Existing rows are not migrated; new writes use the canonical namespace, while already-authorized legacy chat rows remain readable.
- Retention policy governs Molibot's own context/search/memory projections. It does not undo an explicit file write, message send, API call, or other external side effect requested in that turn.
