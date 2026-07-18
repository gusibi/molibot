# Animation / motion plans

Written by `improve-animations` at commit `1980093a`.

| # | Plan | Severity | Status |
|---|------|----------|--------|
| 001 | [Smooth out streaming message rendering](001-streaming-render-smoothness.md) | HIGH | DONE (2026-07-18) |
| 002 | [Chat entrance motion pass](002-chat-entrance-motion.md) | MEDIUM | DONE (2026-07-18) |

Execution order: 001 first — it removes the per-token full-DOM rebuild that
causes the "page keeps refreshing" feel; 002's crossfade entrances then mask
the remaining end-of-turn streaming→persisted row swap. Independent files, no
hard dependency, but feel-checking 002 is meaningless while 001's jank exists.

Deferred (filed, not planned): render the in-flight reply as a provisional
message inside the transcript's keyed `{#each}` (same key morphs into the
final row) to fully eliminate the end-of-turn DOM swap. Revisit if the 001+002
crossfade still shows a visible flash.
