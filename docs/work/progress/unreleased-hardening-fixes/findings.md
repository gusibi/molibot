# Findings

- Recovery uses whole-step replay, so an unrelated tool completion cannot prove an earlier effect safe. Keep checkpoints diagnostic; non-idempotent effects require review before replay.
- Startup and orphan recovery are one-shot; instance renewal waits for an entire worker batch. Lease maintenance must run independently of attempt completion.
- Existing recovery tests advance time before startup and omit overlapping tools. Existing worker tests await whole ticks and do not submit work while a task is blocked.
- QQ treats any successful frame as successful final delivery. Preview truncation happens after a whole-file synchronous read.
- Prior evidence: 73 related tests passed; isolated reproductions demonstrated all eight defects. Root-cause families: ownership/lifecycle, asynchronous concurrency, delivery acknowledgement, resource bounds.
- Final root fixes: independent lease maintenance and startup retry; free-slot dispatch with contained claim errors; whole-step effect review; final-delivery acknowledgement; bounded descriptor reads. Regression guards now cover each family. Stable lease/replay rules were added to CLAUDE.md rather than duplicating incident history in AGENTS.md.
