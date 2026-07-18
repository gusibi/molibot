# 002 — Chat entrance motion pass (transcript + composer surfaces)

- **Status**: TODO
- **Commit**: 1980093a
- **Severity**: MEDIUM
- **Category**: Missed opportunities (preventing jarring changes / feedback)
- **Estimated scope**: 3 files (`styles.css`, `ChatMessagesPane.svelte`, new `settleEntrances.ts`), CSS-first

## Problem

Chat content teleports: new message rows, the assistant "working" row
(`ConversationLiveView.svelte:48`), the queued-messages bar
(`styles.css:1340`), pending file chips (`styles.css:1351`), the approval
card (`styles.css:1184`) and `<details>` bodies (thinking card
`styles.css:1224`, run-activity list `styles.css:1214`) all appear with no
bridge. The end-of-turn swap from the streaming article to the persisted
transcript row re-creates DOM and flashes.

## Target

All entrances use `@starting-style` + `transition` on `opacity`/`transform`
only, with existing tokens (`--duration-fast: 160ms`,
`--duration-normal: 240ms`, `--ease-standard`, `--ease-spring`):

- **Message rows** (includes the streaming row and end-of-turn re-keyed
  rows): opacity-only fade, 160ms `--ease-standard`. No translate — reload
  re-keys rows at turn end and movement would read as jumping; a crossfade
  masks the swap instead.
- **Gating**: entrances only apply under `.messages.settled`. A tiny Svelte
  action (`settleEntrances`) removes `settled` and re-adds it two rAFs after
  mount, keyed by `stickKey + loading`, so switching/first-loading a session
  never replays every row's entrance (repo pitfall: session switch remounts
  the whole keyed `{#each}`).
- **Queued bar**: opacity + translateY(6px), 240ms `--ease-standard`.
- **Pending chip**: opacity + scale(0.95), 160ms `--ease-standard`.
- **Approval card**: opacity 240ms `--ease-standard` + translateY(8px)
  scale(0.985) 240ms `--ease-spring` (matches `modal-in` spatial language,
  `styles.css:1793`).
- **details bodies**: opacity fade-in on open, 160ms; collapse stays instant.

`prefers-reduced-motion` needs no new work: `styles.css:2548` already forces
`transition: none !important` globally, which disables all of the above.

## Repo conventions to follow

- Tokens defined at `styles.css:77-82`; never invent parallel curves.
- Actions live beside `stickToBottom.ts` in `src/lib/chat/`; attach via
  `use:` on the `.messages` container in `ChatMessagesPane.svelte:30`.
- Exemplar entrance: `conversation-empty-in` (`styles.css:974`).

## Steps

1. New `apps/desktop/src/lib/chat/settleEntrances.ts` action (rAF ×2 →
   `classList.add("settled")`; re-arm on key change; cancel on destroy).
2. `ChatMessagesPane.svelte`: `use:settleEntrances={`${stickKey}:${loading}`}`.
3. `styles.css`: add transitions + top-level `@starting-style` blocks for
   `.messages.settled .message-row`, `.queued-messages`, `.pending-chip`,
   `.approval-card`, `.thinking-card[open] pre`,
   `.run-activity[open] .run-activity-list`.

## Boundaries

- Do NOT animate: slash-suggestions menu, conversation-browser dialog,
  sidebar row hover, stickToBottom scrolling, file-panel grid (all rejected
  in audit — keyboard-frequency or layout-thrash).
- Do NOT change component markup beyond the one `use:` attach.
- transform/opacity only; no height/grid animation.

## Verification

- **Mechanical**: `corepack pnpm run check` (0/0), `corepack pnpm run build`.
- **Feel check** (cold-start walk per CLAUDE.md pitfall #9): restart, first
  open of a session shows NO mass entrance replay; send a message — own
  bubble and working row fade in ≤160ms; end of reply crossfades instead of
  flashing; queue a follow-up mid-turn → bar slides in; attach a file → chip
  scales in; open thinking card → body fades in.
- **Done when**: all listed surfaces enter with motion, session switch stays
  instant, reduced-motion disables everything.
