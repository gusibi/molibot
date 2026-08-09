# ADR 0004: Per-domain databases and machine-owned state representation

## Status

Accepted

## Context

Machine-owned state in Molibot lives under `<dataDir>/db/`, with one SQLite file per bounded context:

| File | Owns |
| --- | --- |
| `settings.sqlite` | Settings, including Provider keys and Bot tokens |
| `sessions.db` | Sessions and Agent Context |
| `inbound-queue.sqlite` | Persistent inbound message queue |
| `outbox.sqlite` | Outbound delivery queue |
| `mory.sqlite` | Memory |
| `browserwing.db` | Browser extension state |

This layout grew by accretion rather than by an explicit decision, so two questions recur whenever a subsystem needs new state, and both have been asked again while planning Durable Execution: *why not put this in one database with everything else?* and *why not just keep it in a Markdown or JSON file, which is readable and diffable?*

Both questions deserve a recorded answer, because the appealing option is the wrong one in each case and the reasoning is not visible from the code.

Relevant properties of the current system:

- SQLite permits **one writer at a time per database file**, including in WAL mode. Readers do not block, writers queue.
- `settings.sqlite` holds live credentials; several other stores hold none.
- Stores have unrelated retention, vacuum and migration cadences.
- The Agent has broad filesystem access by design, and models edit files they can see.

## Decision

1. **One database file per bounded context, all under `dbDir`.** New machine-owned state gets its own file rather than a new table inside an existing store. A store is split by *ownership*, not by table count: several tables that one owner writes as one aggregate belong in one file.
2. **State with a state machine, concurrency, or crash-recovery semantics lives in a database — never in a Markdown or JSON file.** Files cannot express optimistic version checks, cannot make two writes atomic, and leave a half-written, undecidable artifact after a crash, which is exactly the moment the state is needed. A Markdown plan has a second failure mode on top of that: it is editable by the model whose behaviour it is meant to constrain, so any rule of the form "the model may not rewrite this record" degrades from enforced to requested.
3. **Within a store, state-machine fields are columns.** Status, version, owner, ordering index, lease ownership, timestamps and any field that is queried, validated or concurrency-protected must be a real column. JSON columns may carry display-only payloads, never a field the state machine depends on — indexes and version checks silently bypass them.
4. **Large content stays out of the state store.** stdout, generated files and traces remain in the artifact/run-detail stores and are referenced by safe identifiers.
5. **The model never writes these stores directly.** All mutations go through shared application-layer actions carrying version and ownership/lease checks. Markdown remains a legitimate *export* format rendered from structured state; a rendered report is never read back as a source of truth.
6. **Cross-store references carry no foreign key, so every dereference must fail soft.** A dangling reference is a normal runtime condition, not an exceptional one.

## Consequences

Gained:

- **Write-lock isolation.** A high-frequency writer cannot make unrelated subsystems queue behind it. This is the strongest practical reason for the split: a store that writes on every tool call would otherwise serialise against ordinary chat message persistence and against every settings save.
- **Blast radius.** A corrupted file, a stuck lock or a bad migration takes down one domain. A subsystem under active development never shares a file with live credentials.
- **Independent lifecycle.** Retention trimming, vacuum, backup cadence and schema migration are per domain, and a subsystem can be reset or rebuilt without surgery on unrelated tables.
- **Test isolation.** Each store is injectable and runs against a temporary database, without standing up every other domain.
- **Scoped-run verifiability.** Each domain's path resolves independently, so a run with a restricted data directory can be checked domain by domain for state escaping to the real data directory.

Accepted costs and the obligations they create:

- **No cross-store transactions or joins.** Atomicity is available only inside one store, so any invariant that must hold atomically has to live in a single store — for example an intent/receipt pair, which is why both sides of such a pair belong to the same database. Consistency *between* stores is reconciled at startup, not enforced by the database.
- **No referential integrity across stores.** Nothing prevents a reference to an artifact, run detail or Session that has since been trimmed, and the database will not report it. Consumers must return an explicit "unavailable / expired" result and continue, never crash and never treat it as a failed operation. Retention policies are keyed so that a live owner's references stay resolvable for as long as the owner is live.
- **More files.** Backup is still a directory copy, but each store owns its own migration path and its own retention policy; neither is inherited.

## When one database is still the right answer

This ADR is not an argument for splitting by table. Keep state in an existing store when it is written by the same owner, participates in the same transactions, and shares that store's retention and migration lifecycle. Split when the writer, the failure domain, the write frequency, or the retention policy differs — those are the four signals that produced the layout above.
