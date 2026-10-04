# ADR 0005: Pi Durable private execution storage

## Status

Accepted — 2026-10-03. The owner authorized completing the remaining integration after reviewing this storage boundary.

## Context

ADR 0004 requires Molibot state-machine fields to be real SQLite columns. Pi Durable 1.0 stores its own task checkpoints and conversation documents through the official Chord SQLite adapter; those private documents include JSON state. Using that adapter unchanged therefore needs an explicit boundary for ADR 0004, rather than an undocumented exception.

The requested kernel replacement keeps Molibot goals, plans, approval policy, budgets, ownership and channel delivery above Pi. Reimplementing Pi's checkpoint storage to imitate Molibot's representation would remove the value of adopting the maintained upstream kernel.

## Decision

1. ADR 0004 continues to govern every Molibot-owned business store. Goal status, plan version, owners, leases, approvals, inbound delivery and recovery decisions remain column-based and mutated through shared application actions.
2. Pi Durable's official SQLite storage is a private third-party execution store. Its upstream document/checkpoint representation is permitted only inside that store. Molibot accesses it through formal Harness/Storage APIs and does not make its private JSON layout a business query or update interface.
3. The Pi store owns committed model/tool execution and results. Molibot does not maintain a second writable copy of that execution state. Session, Trace and goal evidence are read projections rebuilt from committed Pi entries with stable source identities.
4. Atomicity is limited to each store. Pi tool-result/task settlement uses Pi's own commit; Molibot projections reconcile independently. A Molibot receipt alone never proves Pi committed a result.
5. Each Pi storage instance has one active service owner. Service lease loss cancels active work; a second process cannot dispatch from the same execution storage. No distributed execution guarantee is claimed.
6. Existing history remains readable. Old active execution is not silently converted, deleted or replayed; work that cannot safely resume enters explicit recovery review. There is no legacy execution fallback.

## Consequences

The official Pi execution engine can replace the model/tool loop without modifying third-party internals. Molibot retains product semantics and the existing per-domain isolation. This is a narrow representation exception for the Pi-owned store, not permission to move Molibot state-machine fields into JSON.

## Verification required before switching

Formal Runner crash/reopen tests, unknown non-idempotent outcome blocking, approval before intent, projection deduplication, budget and cancellation continuity, service ownership loss, and shared entry tests for chat, plans, automation and internal subagents. Channel contract and live evidence keep their own validation status.
