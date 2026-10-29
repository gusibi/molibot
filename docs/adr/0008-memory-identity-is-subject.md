# ADR 0008: Memory identity and revisions are keyed by subject

## Status

Accepted (2026-10-25)

## Context

Conflicting facts could stay active at the same time. Write-time conflict detection compared strings with negative markers and an overlap threshold, so a low-overlap contradiction such as "I drive a BMW" followed by "I switched to a Tesla" was neither replaced nor flagged. Both records were then eligible for injection, and the read path had no way to choose between them.

## Decision

Every memory carries a stable `subject`. A new value for the same subject is a revision: the new record becomes active, the old one is archived, and the `supersedes` link is kept. Different subjects with high similarity merge when polarity agrees and become a disputed proposal when polarity opposes. The read path injects at most one active record per subject.

Subject values are model-proposed and server-normalized; v1 has no fixed registry, so unknown slots are allowed. Subject drift is handled by dedupe rather than by rejecting writes.

## Consequences

- Two versions of the same fact can never be injected together.
- Old values remain recoverable through the version chain.
- `disputed` becomes a review state for genuinely unresolved conflicts, not a dead-end for every correction.
- Without embeddings, only exact-subject and lexical rules apply; semantic conflicts wait for the embedding path.
