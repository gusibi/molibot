# ADR 0007: One memory write pipeline with type-based auto-commit

## Status

Accepted (2026-10-25)

## Context

Molibot had four memory write paths and two commit channels. An explicit `memory add` and a keyword-based `flush` wrote directly to active memory; LLM session extraction and nightly reflection only produced proposals, and auto-confirm was off by default, so those proposals never became recallable. The only automatic path was keyword matching, while the intelligent path dead-ended in a review queue.

## Decision

One extraction pipeline feeds one writer.

- Explicit durable statements commit immediately.
- Non-sensitive inferences commit immediately.
- Sensitive facts become proposals and wait for review.
- Maintenance (dedupe, import sync, embedding backfill) runs as a background job and leaves the model-facing tool surface.

Nightly consolidation remains, but only for cross-session inference and cleanup; it is no longer the primary path for ordinary facts.

## Consequences

- Memory becomes useful from natural speech, not only from "remember this".
- The review surface becomes an exception path instead of the main path.
- Extraction cost moves to an idle-time background job.
- Historical pending proposals are not auto-confirmed; they were extracted under the old rules.
- `candidate` survives only as a storage detail behind `Proposal`; product language drops it.

## Considered Options

- **Keep both channels and enable auto-confirm** — rejected: the 3-occurrence / 2-session / 2-date gate is unreachable in normal use.
- **Make everything a proposal** — rejected: that is the current failure.
- **Make everything commit automatically** — rejected: sensitive facts need a human gate.
